-- ============================================================
-- 075: Seed the menus for Za Burger, OH Donuts and Pub's Pizza
--
-- Source of truth for the prices below:
--   • Za Burger  — "the burger main menu 22.pdf" (2 pages, A3)
--   • OH Donuts  — "OH.pdf" (2 pages, A4)
--   • Pub's Pizza— the six menu photos in ~/Downloads/pub's/
--
-- Depends on 074 (menu_item_variants / menu_addon_groups).
--
-- Everything here is keyed on natural keys — a menu category by
-- its Arabic name, a menu item by (restaurant_id, Arabic name),
-- a variant by (item, Arabic name) — so re-running the migration
-- re-prices in place instead of duplicating the menu. That matters
-- because these three menus WILL be re-run: the printed menus are
-- reprinted seasonally and this file is the diffable record of
-- what the prices were.
--
-- Sizing conventions taken from the printed menus:
--   • Za Burger  — سنجل / دبل on every burger and chicken sandwich
--   • Pub's      — M 25cm / L 30cm / Family 39cm, each also in a
--     cheese-stuffed crust; half-&-half is priced per نص (half of
--     a Large) and per ربع (quarter of a Family)
--   • OH Donuts  — S / D on the coffee board, S / F on cheesecake
--     and brownies, single price everywhere else
-- ============================================================


-- ── 0) Seeding helpers (dropped at the end of this file) ──────

create or replace function public._seed_menu_item(
  p_rest      uuid,
  p_cat_ar    text,
  p_cat_en    text,
  p_name_ar   text,
  p_name_en   text,
  p_desc_ar   text,
  p_sort      integer,
  p_price     numeric,
  p_variants  jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cat  uuid;
  v_item uuid;
  v_v    jsonb;
  v_i    integer := 0;
begin
  -- Global menu taxonomy, find-or-create by Arabic name (the same
  -- rule _find_or_create_menu_category uses, so owner-promoted
  -- categories and seeded ones converge instead of duplicating).
  select id into v_cat from menu_categories
  where lower(btrim(name_ar)) = lower(btrim(p_cat_ar));

  if v_cat is null then
    insert into menu_categories (name_ar, name_en, is_active, sort_order)
    values (p_cat_ar, coalesce(p_cat_en, p_cat_ar), true,
            coalesce((select max(sort_order) + 1 from menu_categories), 0))
    returning id into v_cat;
  end if;

  select id into v_item from menu_items
  where restaurant_id = p_rest
    and lower(btrim(name_ar)) = lower(btrim(p_name_ar));

  if v_item is null then
    insert into menu_items (restaurant_id, category_id, name_ar, name_en,
                            price, description_ar, is_available, sort_order)
    values (p_rest, v_cat, p_name_ar, p_name_en,
            p_price, nullif(btrim(coalesce(p_desc_ar, '')), ''), true, p_sort)
    returning id into v_item;
  else
    update menu_items set
      category_id    = v_cat,
      name_en        = p_name_en,
      price          = p_price,
      description_ar = nullif(btrim(coalesce(p_desc_ar, '')), ''),
      sort_order     = p_sort,
      updated_at     = now()
    where id = v_item;
  end if;

  if p_variants is not null then
    -- Clear defaults first: uq_menu_item_variants_one_default would
    -- reject a second default row mid-loop on a re-run.
    update menu_item_variants set is_default = false where menu_item_id = v_item;

    for v_v in select * from jsonb_array_elements(p_variants) loop
      v_i := v_i + 1;
      insert into menu_item_variants
        (menu_item_id, name_ar, name_en, price, is_default, sort_order)
      values
        (v_item, v_v->>'ar', v_v->>'en', (v_v->>'price')::numeric,
         coalesce((v_v->>'def')::boolean, false), v_i)
      on conflict (menu_item_id, lower(btrim(name_ar))) do update
        set price      = excluded.price,
            name_en    = excluded.name_en,
            is_default = excluded.is_default,
            sort_order = excluded.sort_order,
            updated_at = now();
    end loop;
  end if;

  return v_item;
end $$;


-- Creates the group + its rows, then attaches it to every item of
-- this restaurant that sits in one of p_attach_cats.
create or replace function public._seed_addon_group(
  p_rest        uuid,
  p_name_ar     text,
  p_name_en     text,
  p_addons      jsonb,          -- [{"ar":"جبنة","en":"Cheese","price":10}, …]
  p_attach_cats text[],
  p_max_select  integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_a     jsonb;
  v_i     integer := 0;
begin
  select id into v_group from menu_addon_groups
  where restaurant_id = p_rest and lower(btrim(name_ar)) = lower(btrim(p_name_ar));

  if v_group is null then
    insert into menu_addon_groups (restaurant_id, name_ar, name_en, min_select, max_select, sort_order)
    values (p_rest, p_name_ar, p_name_en, 0, p_max_select, 0)
    returning id into v_group;
  else
    update menu_addon_groups
    set name_en = p_name_en, max_select = p_max_select, updated_at = now()
    where id = v_group;
  end if;

  for v_a in select * from jsonb_array_elements(p_addons) loop
    v_i := v_i + 1;
    insert into menu_addons (group_id, name_ar, name_en, price_delta, sort_order)
    values (v_group, v_a->>'ar', v_a->>'en', (v_a->>'price')::numeric, v_i)
    on conflict (group_id, lower(btrim(name_ar))) do update
      set price_delta = excluded.price_delta,
          name_en     = excluded.name_en,
          sort_order  = excluded.sort_order,
          updated_at  = now();
  end loop;

  insert into menu_item_addon_groups (menu_item_id, group_id, sort_order)
  select mi.id, v_group, 0
  from menu_items mi
  join menu_categories mc on mc.id = mi.category_id
  where mi.restaurant_id = p_rest
    and mc.name_ar = any (p_attach_cats)
  on conflict (menu_item_id, group_id) do nothing;

  return v_group;
end $$;


-- ── 1) Clean the placeholder category ─────────────────────────
-- `menu_categories` currently holds exactly one junk row ("sd")
-- from an admin smoke test, with one item pointing at it. Detach
-- the item rather than cascading, then drop the row.
update public.menu_items
set category_id = null
where category_id in (select id from public.menu_categories where name_ar = 'sd');

delete from public.menu_categories where name_ar = 'sd';


-- ── 2) Za Burger ──────────────────────────────────────────────
do $$
declare
  r uuid := 'd9772ac5-2835-47d0-aef5-7fb028c85abd';
begin

  -- بيف برجر (سنجل / دبل)
  perform public._seed_menu_item(r,'برجر','Burgers','برجر بالجبنة','Cheese Burger',
    'قطعة لحم بقري - امريكان تشيز - بصل - طماطم - خيار - خس - صوص الف جزيرة',1,135,
    '[{"ar":"سنجل","en":"Single","price":135,"def":true},{"ar":"دبل","en":"Double","price":195}]');
  perform public._seed_menu_item(r,'برجر','Burgers','برجر تشاتشا','Cha Cha Burger',
    'قطعة لحم بقري - امريكان تشيز - بصل - خيار - خس - هالبينو - سويت تشيلي - ساموراي',2,145,
    '[{"ar":"سنجل","en":"Single","price":145,"def":true},{"ar":"دبل","en":"Double","price":205}]');
  perform public._seed_menu_item(r,'برجر','Burgers','برجر مدخن','Smoked Burger',
    'قطعة لحم بقري - بيكون - حلقات بصل مقلي - شيدر صوص - خيار - خس - صوص باربيكيو',3,160,
    '[{"ar":"سنجل","en":"Single","price":160,"def":true},{"ar":"دبل","en":"Double","price":220}]');
  perform public._seed_menu_item(r,'برجر','Burgers','برجر مشروم','Mushroom Burger',
    'قطعة لحم بقري - مشروم - وايت تشيز - بصل مكرمل - خيار - صوص رانش',4,170,
    '[{"ar":"سنجل","en":"Single","price":170,"def":true},{"ar":"دبل","en":"Double","price":230}]');
  perform public._seed_menu_item(r,'برجر','Burgers','برجر اوه','OH Burger',
    'قطعة لحم بقري - بيكون - موتزريلا ستيكس - وايت تشيز - خيار - خس - صوص بوسطن',5,180,
    '[{"ar":"سنجل","en":"Single","price":180,"def":true},{"ar":"دبل","en":"Double","price":240}]');
  perform public._seed_menu_item(r,'برجر','Burgers','برجر زا','Za Burger',
    'قطعة لحم بقري - قطعة لحم ستيك - وايت تشيز - امريكان تشيز - بصل مشوي - خيار - خس - صوص بوسطن',6,180,
    '[{"ar":"سنجل","en":"Single","price":180,"def":true},{"ar":"دبل","en":"Double","price":240}]');

  -- سماش برجر (سنجل / دبل)
  perform public._seed_menu_item(r,'سماش برجر','Smash Burgers','سماش كلاسيك','Smash Classic',
    'قطعة لحم بقري - امريكان تشيز - بصل - طماطم - خيار - خس - صوص الف جزيرة',1,125,
    '[{"ar":"سنجل","en":"Single","price":125,"def":true},{"ar":"دبل","en":"Double","price":175}]');
  perform public._seed_menu_item(r,'سماش برجر','Smash Burgers','سماش تكساس','Smash Texas',
    'قطعة لحم بقري - بيكون - امريكان تشيز - بصل - خيار - خس - صوص تكساس',2,140,
    '[{"ar":"سنجل","en":"Single","price":140,"def":true},{"ar":"دبل","en":"Double","price":190}]');
  perform public._seed_menu_item(r,'سماش برجر','Smash Burgers','سماش مشروم','Smash Mushroom',
    'قطعة لحم بقري - مشروم - وايت تشيز - بصل مكرمل - خيار - صوص رانش',3,150,
    '[{"ar":"سنجل","en":"Single","price":150,"def":true},{"ar":"دبل","en":"Double","price":200}]');

  -- سندوتشات فراخ (سنجل / دبل)
  perform public._seed_menu_item(r,'سندوتشات فراخ','Chicken Sandwiches','فراخ كلاسيك','Classic Chicken',
    'صدور فراخ - خيار - خس - امريكان تشيز - صوص الف جزيرة',1,135,
    '[{"ar":"سنجل","en":"Single","price":135,"def":true},{"ar":"دبل","en":"Double","price":195}]');
  perform public._seed_menu_item(r,'سندوتشات فراخ','Chicken Sandwiches','فراخ باربيكو','BBQ Chicken',
    'صدور فراخ - خيار - خس - حلقات بصل - صوص شيدر - صوص باربكيو',2,140,
    '[{"ar":"سنجل","en":"Single","price":140,"def":true},{"ar":"دبل","en":"Double","price":200}]');
  perform public._seed_menu_item(r,'سندوتشات فراخ','Chicken Sandwiches','فراخ تشا تشا','Cha Cha Chicken',
    'صدور فراخ - خيار - خس - امريكان تشيز - هالبينو - صوص ساموراي - صوص سويت تشيلي',3,145,
    '[{"ar":"سنجل","en":"Single","price":145,"def":true},{"ar":"دبل","en":"Double","price":205}]');
  perform public._seed_menu_item(r,'سندوتشات فراخ','Chicken Sandwiches','فراخ بوسطن','Boston Chicken',
    'صدور فراخ - خيار - خس - صوص بوسطن - امريكان تشيز - رومي',4,150,
    '[{"ar":"سنجل","en":"Single","price":150,"def":true},{"ar":"دبل","en":"Double","price":210}]');
  perform public._seed_menu_item(r,'سندوتشات فراخ','Chicken Sandwiches','فراخ تكساس','Texas Chicken',
    'صدور فراخ - خيار - خس - صوص تكساس - موتزريلا ستيك - امريكان تشيز',5,155,
    '[{"ar":"سنجل","en":"Single","price":155,"def":true},{"ar":"دبل","en":"Double","price":215}]');
  perform public._seed_menu_item(r,'سندوتشات فراخ','Chicken Sandwiches','فراخ بابس','Pub''s Chicken',
    'صدور فراخ - خيار - صوص رانش - وايت تشيز - رومي - مشروم - بصل مكرمل',6,165,
    '[{"ar":"سنجل","en":"Single","price":165,"def":true},{"ar":"دبل","en":"Double","price":225}]');

  -- منيو الراب
  perform public._seed_menu_item(r,'راب','Wraps','راب كلاسيك','Classic Wrap',
    'قطع ستربس - امريكان تشيز - خيار - خس - صوص الف جزيرة',1,105);
  perform public._seed_menu_item(r,'راب','Wraps','راب بوسطن','Boston Wrap',
    'قطع ستربس - رومي مدخن - امريكان تشيز - خيار - خس - صوص بوسطن',2,120);
  perform public._seed_menu_item(r,'راب','Wraps','راب بابس','Pub''s Wrap',
    'قطع ستربس - رومي مدخن - وايت تشيز - خيار - بصل - صوص رانش',3,125);
  perform public._seed_menu_item(r,'راب','Wraps','راب كفتة','Kofta Wrap',
    'كفتة - سلطة - طحينة',4,115);
  perform public._seed_menu_item(r,'راب','Wraps','راب سجق','Sausage Wrap',
    'سجق - بصل - هالبينو - طماطم - رانش',5,115);
  perform public._seed_menu_item(r,'راب','Wraps','راب فاهيتا فراخ','Chicken Fajita Wrap',
    'فاهيتا فراخ - خيار - امريكان تشيز - مايونيز',6,120);
  perform public._seed_menu_item(r,'راب','Wraps','راب فاهيتا لحم','Beef Fajita Wrap',
    'فاهيتا لحم - خيار - امريكان تشيز - مايونيز',7,135);
  perform public._seed_menu_item(r,'راب','Wraps','راب تكساس','Texas Wrap',
    'قطعة برجر - امريكان تشيز - بيكون - خيار - بصل - خس - صوص تكساس',8,140);
  perform public._seed_menu_item(r,'راب','Wraps','راب مشروم فراخ','Chicken Mushroom Wrap',
    'فراخ - مشروم - امريكان تشيز - خيار - بصل مكرمل - صوص رانش',9,140);
  perform public._seed_menu_item(r,'راب','Wraps','راب مشروم لحم','Beef Mushroom Wrap',
    'لحم - مشروم - امريكان تشيز - خيار - بصل مكرمل - صوص رانش',10,150);

  -- المقبلات
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','بطاطس مقلية','French Fries',
    'بطاطس كرينكل',1,40);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','بطاطس بالجبنة','Cheese Fries',
    'بطاطس متبلة - صوص شيدر',2,75);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','بطاطس بالجبنة الحارة','Spicy Cheese Fries',
    'بطاطس متبلة - صوص شيدر - قطع هالبينو - صوص تشيلي - ساموراي',3,85);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','بطاطس فراخ','Chicken Fries',
    'بطاطس متبلة - قطع دجاج ستربس - رومي مدخن - شيدر صوص - صوص رانش',4,105);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','بطاطس ستيك','Steak Fries',
    'بطاطس متبلة - قطع لحم ستيك - بصل مشوي - شيدر صوص - صوص بوسطن',5,115);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','حلقات البصل','Onion Rings',
    '6 حلقات بصل مقلية - صوص من اختيارك',6,50);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','موتزريلا ستيكس','Mozzarella Sticks',
    '4 قطع موتزريلا ستيكس - صوص من اختيارك',7,55);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','ناجتس','Nuggets',
    '6 قطع ناجتس - صوص من اختيارك',8,60);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','فراخ تندر','Chicken Tenders',
    '3 قطع دجاج ستربس - صوص من اختيارك',9,85);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','كومبو','Combo',
    'بطاطس كرينكل - مشروب سوفت درينك',10,50);

  -- وجبات الأطفال
  perform public._seed_menu_item(r,'وجبات أطفال','Kids Meals','وجبة ناجتس الأطفال','Kids Nuggets Meal',
    '4 قطع ناجتس - فرايز - عصير - صوص - لعبة',1,80);
  perform public._seed_menu_item(r,'وجبات أطفال','Kids Meals','وجبة فراخ الأطفال','Kids Chicken Meal',
    'ساندوتش تشكن برجر - فرايز - عصير - لعبة',2,90,
    '[{"ar":"سنجل","en":"Single","price":90,"def":true},{"ar":"دبل","en":"Double","price":120}]');
  perform public._seed_menu_item(r,'وجبات أطفال','Kids Meals','وجبة البيف الأطفال','Kids Beef Meal',
    'ساندوتش بيف برجر - فرايز - عصير - لعبة',3,105,
    '[{"ar":"سنجل","en":"Single","price":105,"def":true},{"ar":"دبل","en":"Double","price":150}]');
  perform public._seed_menu_item(r,'وجبات أطفال','Kids Meals','ساندوتش فراخ الأطفال','Kids Chicken Sandwich',
    'قطعة دجاج - امريكان تشيز - خس - صوص رانش',4,65,
    '[{"ar":"سنجل","en":"Single","price":65,"def":true},{"ar":"دبل","en":"Double","price":95}]');
  perform public._seed_menu_item(r,'وجبات أطفال','Kids Meals','ساندوتش بيف الأطفال','Kids Beef Sandwich',
    'قطعة لحم بقري - امريكان تشيز - خس - صوص الف جزيرة',5,75,
    '[{"ar":"سنجل","en":"Single","price":75,"def":true},{"ar":"دبل","en":"Double","price":120}]');

  -- العروض
  perform public._seed_menu_item(r,'عروض ووجبات','Combos & Offers','بوكس 2 ساندوتش','2-Sandwich Box',
    '2 ساندوتش راب مختلفين من اختيارك + فرايز + 1 صوص',1,235);
  perform public._seed_menu_item(r,'عروض ووجبات','Combos & Offers','بوكس 4 ساندوتش','4-Sandwich Box',
    '4 ساندوتش راب مختلفين من اختيارك + 2 فرايز + 2 صوص',2,435);
  perform public._seed_menu_item(r,'عروض ووجبات','Combos & Offers','عرض الدبل','Double Offer',
    '2 ساندوتش من اختيارك + فرايز + لتر سوفت درينك — الاختيار بين برجر جبنة / برجر تشا تشا / دجاج كلاسيك / دجاج تشا تشا',3,280);
  perform public._seed_menu_item(r,'عروض ووجبات','Combos & Offers','عرض العائلي','Family Offer',
    '4 ساندوتش من اختيارك + 2 فرايز + لتر سوفت درينك — الاختيار بين برجر جبنة / برجر تشا تشا / دجاج كلاسيك / دجاج تشا تشا',4,500);

  -- المشروبات
  perform public._seed_menu_item(r,'مشروبات','Drinks','مياه معدنية','Mineral Water',null,1,10);
  perform public._seed_menu_item(r,'مشروبات','Drinks','مشروب غازي','Soft Drink',null,2,20);
  perform public._seed_menu_item(r,'مشروبات','Drinks','لتر مشروب غازي','Soft Drink 1L',null,3,30);
  perform public._seed_menu_item(r,'مشروبات','Drinks','عصير أطفال','Kids Juice',null,4,15);

  -- الأضافات
  perform public._seed_addon_group(r,'الأضافات','Add-ons',
    '[{"ar":"قطعة بيف برجر","en":"Beef Burger Patty","price":60},
      {"ar":"قطعة برجر سماش","en":"Smash Patty","price":50},
      {"ar":"قطعة ساندوتش برجر دجاج","en":"Chicken Burger Patty","price":60},
      {"ar":"قطعة برجر دجاج للاطفال","en":"Kids Chicken Patty","price":30},
      {"ar":"قطعة بيف للاطفال","en":"Kids Beef Patty","price":45},
      {"ar":"جبنة امريكان","en":"American Cheese","price":10},
      {"ar":"صوص شيدر","en":"Cheddar Sauce","price":25},
      {"ar":"صوص جبن ابيض","en":"White Cheese Sauce","price":25},
      {"ar":"خيار مخلل","en":"Pickles","price":10},
      {"ar":"هالبينو","en":"Jalapeno","price":10},
      {"ar":"صوص","en":"Sauce","price":15},
      {"ar":"مشروم و بصل","en":"Mushroom & Onion","price":25},
      {"ar":"بيكون","en":"Bacon","price":25},
      {"ar":"سموكد تركي","en":"Smoked Turkey","price":20},
      {"ar":"ستيك لحم","en":"Beef Steak","price":25}]',
    array['برجر','سماش برجر','سندوتشات فراخ','راب']);

end $$;


-- ── 3) OH Donuts ──────────────────────────────────────────────
do $$
declare
  r uuid := '440db723-3997-4349-a43d-5136d905c2fa';
begin

  -- دونات بومب
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات سنو نوتيلا','Snow Nutella Donut',null,1,55);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات باسترى جليز','Pastry Glaze Donut',null,2,55);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات باسترى كريم','Pastry Cream Donut',null,3,55);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات سنو فراولة','Snow Strawberry Donut',null,4,55);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات سنو لوتس','Snow Lotus Donut',null,5,55);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات باسترى نوتيلا','Pastry Nutella Donut',null,6,60);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات نوتيلا','Nutella Donut',null,7,60);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات وايت شوكلت اوريو','White Chocolate Oreo Donut',null,8,60);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات توفي كراميل','Toffee Caramel Donut',null,9,60);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات لوتس','Lotus Donut',null,10,60);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات سنو بلو بيرى','Snow Blueberry Donut',null,11,65);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات وايت شوكلت فراولة','White Chocolate Strawberry Donut',null,12,65);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات سنو فسدق','Snow Pistachio Donut',null,13,70);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات وايت شوكلت بلوبيرى','White Chocolate Blueberry Donut',null,14,70);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات كيندر','Kinder Donut',null,15,75);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات ميلك شوكليت','Milk Chocolate Donut',null,16,75);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات فسدق','Pistachio Donut',null,17,90);
  perform public._seed_menu_item(r,'دوناتس','Donuts','دونات دبي','Dubai Donut',null,18,90);

  -- دونات رينج
  perform public._seed_menu_item(r,'دوناتس','Donuts','رينج جليز','Glaze Ring',null,19,45);
  perform public._seed_menu_item(r,'دوناتس','Donuts','رينج سكر','Sugar Ring',null,20,45);
  perform public._seed_menu_item(r,'دوناتس','Donuts','رينج لوتس','Lotus Ring',null,21,50);
  perform public._seed_menu_item(r,'دوناتس','Donuts','رينج نوتيلا','Nutella Ring',null,22,50);
  perform public._seed_menu_item(r,'دوناتس','Donuts','رينج وايت شوكلت اوريو','White Chocolate Oreo Ring',null,23,50);
  perform public._seed_menu_item(r,'دوناتس','Donuts','رينج توفى كراميل','Toffee Caramel Ring',null,24,50);
  perform public._seed_menu_item(r,'دوناتس','Donuts','رينج ميلك شوكليت','Milk Chocolate Ring',null,25,60);
  perform public._seed_menu_item(r,'دوناتس','Donuts','رينج كيندر','Kinder Ring',null,26,60);
  perform public._seed_menu_item(r,'دوناتس','Donuts','رينج فسدق','Pistachio Ring',null,27,65);

  -- بوكسات
  perform public._seed_menu_item(r,'بوكسات','Boxes','بومب بوكس 4 قطع','Bomb Box 4 pcs',null,1,240);
  perform public._seed_menu_item(r,'بوكسات','Boxes','بومب بوكس 6 قطع','Bomb Box 6 pcs',null,2,330);
  perform public._seed_menu_item(r,'بوكسات','Boxes','ميني بومب بوكس 6 قطع','Mini Bomb Box 6 pcs',null,3,210);
  perform public._seed_menu_item(r,'بوكسات','Boxes','ميني بومب بوكس 12 قطعة','Mini Bomb Box 12 pcs',null,4,360);
  perform public._seed_menu_item(r,'بوكسات','Boxes','رينج بوكس 4 قطع','Ring Box 4 pcs',null,5,170);
  perform public._seed_menu_item(r,'بوكسات','Boxes','رينج بوكس 6 قطع','Ring Box 6 pcs',null,6,230);

  -- كرواسون (بعضه بحجمين)
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون سادة','Plain Croissant',null,1,50);
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون جبنة','Cheese Croissant',null,2,65);
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون باسترى سنو','Pastry Snow Croissant',null,3,75);
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون اوريو','Oreo Croissant',null,4,75,
    '[{"ar":"صغير","en":"Small","price":75,"def":true},{"ar":"كبير","en":"Large","price":100}]');
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون نوتيلا','Nutella Croissant',null,5,75,
    '[{"ar":"صغير","en":"Small","price":75,"def":true},{"ar":"كبير","en":"Large","price":100}]');
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون لوتس','Lotus Croissant',null,6,75,
    '[{"ar":"صغير","en":"Small","price":75,"def":true},{"ar":"كبير","en":"Large","price":100}]');
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون سموكد تركى','Smoked Turkey Croissant',null,7,90);
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون بلوبيرى','Blueberry Croissant',null,8,90);
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون فراولة','Strawberry Croissant',null,9,90);
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون كيندر','Kinder Croissant',null,10,90,
    '[{"ar":"صغير","en":"Small","price":90,"def":true},{"ar":"كبير","en":"Large","price":120}]');
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون بستاشيو','Pistachio Croissant',null,11,100,
    '[{"ar":"صغير","en":"Small","price":100,"def":true},{"ar":"كبير","en":"Large","price":130}]');
  perform public._seed_menu_item(r,'كرواسون','Croissants','كرواسون دبي','Dubai Croissant',null,12,100);

  -- مخبوزات وحلويات
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','سينامون كلاسيك','Classic Cinnamon',null,1,90);
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','سينامون شيكولاتة','Chocolate Cinnamon',null,2,95);
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','سينامون كراميل','Caramel Cinnamon',null,3,95);
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','كوكيز كلاسيك','Classic Cookies',null,4,50);
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','كوكيز شوكليت','Chocolate Cookies',null,5,50);
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','دانش باسترى','Pastry Danish',null,6,70);
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','دانش فراولة','Strawberry Danish',null,7,80);
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','دانش بلوبيرى','Blueberry Danish',null,8,80);
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','مافن شوكليت','Chocolate Muffin',null,9,60);
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','باتيه جبنة و زعتر','Cheese & Zaatar Patisserie',null,10,60);

  -- براونيز (صغير / كبير)
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','براونيز شوكليت','Chocolate Brownies',null,11,90,
    '[{"ar":"صغير","en":"Small","price":90,"def":true},{"ar":"كبير","en":"Large","price":120}]');
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','براونيز نوتيلا','Nutella Brownies',null,12,100,
    '[{"ar":"صغير","en":"Small","price":100,"def":true},{"ar":"كبير","en":"Large","price":130}]');
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','براونيز لوتس','Lotus Brownies',null,13,105,
    '[{"ar":"صغير","en":"Small","price":105,"def":true},{"ar":"كبير","en":"Large","price":135}]');
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','براونيز فسدق','Pistachio Brownies',null,14,115,
    '[{"ar":"صغير","en":"Small","price":115,"def":true},{"ar":"كبير","en":"Large","price":145}]');

  -- بروفيترول / تيراميسو (قطعة / تورتة)
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','بروفيترول','Profiterole',null,15,110,
    '[{"ar":"قطعة","en":"Slice","price":110,"def":true},{"ar":"تورتة","en":"Whole","price":325}]');
  perform public._seed_menu_item(r,'مخبوزات وحلويات','Bakery & Desserts','تيراميسو','Tiramisu',null,16,120,
    '[{"ar":"قطعة","en":"Slice","price":120,"def":true},{"ar":"تورتة","en":"Whole","price":350}]');

  -- تشيز كيك (قطعة / تورتة)
  perform public._seed_menu_item(r,'كيك وتشيز كيك','Cakes & Cheesecake','تشيز كيك كلاسيك','Classic Cheesecake',null,1,90,
    '[{"ar":"قطعة","en":"Slice","price":90,"def":true},{"ar":"تورتة","en":"Whole","price":380}]');
  perform public._seed_menu_item(r,'كيك وتشيز كيك','Cakes & Cheesecake','تشيز كيك مانجو','Mango Cheesecake',null,2,100,
    '[{"ar":"قطعة","en":"Slice","price":100,"def":true},{"ar":"تورتة","en":"Whole","price":420}]');
  perform public._seed_menu_item(r,'كيك وتشيز كيك','Cakes & Cheesecake','تشيز كيك لوتس','Lotus Cheesecake',null,3,100,
    '[{"ar":"قطعة","en":"Slice","price":100,"def":true},{"ar":"تورتة","en":"Whole","price":420}]');
  perform public._seed_menu_item(r,'كيك وتشيز كيك','Cakes & Cheesecake','تشيز كيك نوتيلا','Nutella Cheesecake',null,4,100,
    '[{"ar":"قطعة","en":"Slice","price":100,"def":true},{"ar":"تورتة","en":"Whole","price":420}]');
  perform public._seed_menu_item(r,'كيك وتشيز كيك','Cakes & Cheesecake','تشيز كيك بلوبيرى','Blueberry Cheesecake',null,5,105,
    '[{"ar":"قطعة","en":"Slice","price":105,"def":true},{"ar":"تورتة","en":"Whole","price":450}]');
  perform public._seed_menu_item(r,'كيك وتشيز كيك','Cakes & Cheesecake','تشيز كيك فراولة','Strawberry Cheesecake',null,6,105,
    '[{"ar":"قطعة","en":"Slice","price":105,"def":true},{"ar":"تورتة","en":"Whole","price":450}]');
  perform public._seed_menu_item(r,'كيك وتشيز كيك','Cakes & Cheesecake','تشيز كيك فسدق','Pistachio Cheesecake',null,7,115,
    '[{"ar":"قطعة","en":"Slice","price":115,"def":true},{"ar":"تورتة","en":"Whole","price":550}]');

  -- ايس كريم
  perform public._seed_menu_item(r,'ايس كريم','Ice Cream','ايس كريم بولة','1 Scoop Ice Cream',null,1,35);
  perform public._seed_menu_item(r,'ايس كريم','Ice Cream','ايس كريم بولتين','2 Scoops Ice Cream',null,2,60);
  perform public._seed_menu_item(r,'ايس كريم','Ice Cream','ايس كريم 3 بولات','3 Scoops Ice Cream',null,3,80);

  -- قهوة ساخنة (S / D)
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','اسبريسو','Espresso',null,1,35,
    '[{"ar":"سنجل","en":"Single","price":35,"def":true},{"ar":"دبل","en":"Double","price":50}]');
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','ميكاتو','Macchiato',null,2,45,
    '[{"ar":"سنجل","en":"Single","price":45,"def":true},{"ar":"دبل","en":"Double","price":55}]');
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','كورتو','Cortado',null,3,70);
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','امريكان','Americano',null,4,60);
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','كابتشينو','Cappuccino',null,5,85);
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','لاتيه','Latte',null,6,85);
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','فلات وايت','Flat White',null,7,95);
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','كراميل ميكاتو','Caramel Macchiato',null,8,100);
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','موكا','Mocha',null,9,100);
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','وايت موكا','White Mocha',null,10,100);
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','اسبانش لاتيه','Spanish Latte',null,11,100);
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','قهوة تركى','Turkish Coffee',null,12,35,
    '[{"ar":"سنجل","en":"Single","price":35,"def":true},{"ar":"دبل","en":"Double","price":45}]');
  perform public._seed_menu_item(r,'قهوة ساخنة','Hot Coffee','قهوة فرنساوى','French Coffee',null,13,45,
    '[{"ar":"سنجل","en":"Single","price":45,"def":true},{"ar":"دبل","en":"Double","price":50}]');

  -- ايس كوفى
  perform public._seed_menu_item(r,'قهوة باردة','Iced Coffee','ايس امريكانو','Iced Americano',null,1,60);
  perform public._seed_menu_item(r,'قهوة باردة','Iced Coffee','ايس لاتيه','Iced Latte',null,2,80);
  perform public._seed_menu_item(r,'قهوة باردة','Iced Coffee','ايس كابتشينو','Iced Cappuccino',null,3,90);
  perform public._seed_menu_item(r,'قهوة باردة','Iced Coffee','ايس فلات وايت','Iced Flat White',null,4,95);
  perform public._seed_menu_item(r,'قهوة باردة','Iced Coffee','ايس اسبانش لاتيه','Iced Spanish Latte',null,5,100);
  perform public._seed_menu_item(r,'قهوة باردة','Iced Coffee','ايس موكا','Iced Mocha',null,6,100);
  perform public._seed_menu_item(r,'قهوة باردة','Iced Coffee','ايس وايت موكا','Iced White Mocha',null,7,100);
  perform public._seed_menu_item(r,'قهوة باردة','Iced Coffee','ايس كراميل ميكاتو','Iced Caramel Macchiato',null,8,100);

  -- فرابيه وميلك شيك
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','فرابيه جوز هند فراوله','Coconut Strawberry Frappe',null,1,90);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','فرابيه كراميل','Caramel Frappe',null,2,95);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','فرابيه بلوبيرى','Blueberry Frappe',null,3,95);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','كوفي فرابيه','Coffee Frappe',null,4,100);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','اوه فرابيه كوكيز','OH Cookies Frappe',null,5,100);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','اوه فرابيه براونيز','OH Brownies Frappe',null,6,100);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','ميلك شيك فانيليا','Vanilla Milkshake',null,7,125);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','ميلك شيك شوكليت','Chocolate Milkshake',null,8,125);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','ميلك شيك فراولة','Strawberry Milkshake',null,9,125);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','ميلك شيك مانجو','Mango Milkshake',null,10,125);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','ميلك شيك اوريو','Oreo Milkshake',null,11,125);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','ميلك شيك كراميل','Caramel Milkshake',null,12,125);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','ميلك شيك نوتيلا','Nutella Milkshake',null,13,125);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','ميلك شيك اسبريسو','Espresso Milkshake',null,14,135);
  perform public._seed_menu_item(r,'فرابيه وميلك شيك','Frappe & Milkshake','ميلك شيك فسدق','Pistachio Milkshake',null,15,135);

  -- شاي ومشروبات ساخنة
  perform public._seed_menu_item(r,'شاي ومشروبات ساخنة','Tea & Hot Drinks','شاى احمر','Black Tea',null,1,30);
  perform public._seed_menu_item(r,'شاي ومشروبات ساخنة','Tea & Hot Drinks','شاى ايرلى جراى','Earl Grey Tea',null,2,30);
  perform public._seed_menu_item(r,'شاي ومشروبات ساخنة','Tea & Hot Drinks','شاى اخضر بالنعناع','Green Mint Tea',null,3,30);
  perform public._seed_menu_item(r,'شاي ومشروبات ساخنة','Tea & Hot Drinks','هوت شوكليت كلاسيك','Classic Hot Chocolate',null,4,70);
  perform public._seed_menu_item(r,'شاي ومشروبات ساخنة','Tea & Hot Drinks','هوت شوكليت ايطالى','Italian Hot Chocolate',null,5,75);
  perform public._seed_menu_item(r,'شاي ومشروبات ساخنة','Tea & Hot Drinks','هوت شوكليت مارشيملو','Marshmallow Hot Chocolate',null,6,90);

  -- عصائر وموهيتو
  perform public._seed_menu_item(r,'عصائر وموهيتو','Juices & Mojito','عصير برتقال','Orange Juice',null,1,60);
  perform public._seed_menu_item(r,'عصائر وموهيتو','Juices & Mojito','عصير مانجو','Mango Juice',null,2,60);
  perform public._seed_menu_item(r,'عصائر وموهيتو','Juices & Mojito','عصير فراولة','Strawberry Juice',null,3,60);
  perform public._seed_menu_item(r,'عصائر وموهيتو','Juices & Mojito','عصير ليمون نعناع','Lemon Mint Juice',null,4,60);
  perform public._seed_menu_item(r,'عصائر وموهيتو','Juices & Mojito','موهيتو كلاسيك','Classic Mojito',null,5,60);
  perform public._seed_menu_item(r,'عصائر وموهيتو','Juices & Mojito','موهيتو فراولة','Strawberry Mojito',null,6,70);
  perform public._seed_menu_item(r,'عصائر وموهيتو','Juices & Mojito','موهيتو بلوبيرى','Blueberry Mojito',null,7,70);
  perform public._seed_menu_item(r,'عصائر وموهيتو','Juices & Mojito','مياه معدنية','Mineral Water',null,8,15);

  -- عروض
  perform public._seed_menu_item(r,'عروض ووجبات','Combos & Offers','ايس كوفي + دونات بومب نوتيلا','Iced Coffee + Nutella Bomb Donut',null,1,125);
  perform public._seed_menu_item(r,'عروض ووجبات','Combos & Offers','ايس كوفي + كرواسون باسترى سنو','Iced Coffee + Pastry Snow Croissant',null,2,125);

  -- اكسترا
  perform public._seed_addon_group(r,'اكسترا','Extras',
    '[{"ar":"حليب","en":"Milk","price":15},
      {"ar":"شوكليت","en":"Chocolate","price":25},
      {"ar":"فراولة","en":"Strawberry","price":25},
      {"ar":"فليفر","en":"Flavour","price":25},
      {"ar":"كراميل","en":"Caramel","price":25},
      {"ar":"لوتس","en":"Lotus","price":25},
      {"ar":"اسبريسو","en":"Espresso","price":30},
      {"ar":"بلو بيرى","en":"Blueberry","price":30},
      {"ar":"وبينج كريم","en":"Whipping Cream","price":30},
      {"ar":"ايس كريم","en":"Ice Cream","price":35},
      {"ar":"كيندر","en":"Kinder","price":35},
      {"ar":"فسدق","en":"Pistachio","price":40}]',
    array['قهوة ساخنة','قهوة باردة','فرابيه وميلك شيك','شاي ومشروبات ساخنة']);

end $$;


-- ── 4) Pub's Pizza ────────────────────────────────────────────
do $$
declare
  r uuid := 'c44f9430-0c38-4717-9f2e-175f58803dcc';
begin

  -- بيتزا: وسط 25سم / لارج 30سم / فاميلي 39سم، وكل حجم بعجينة محشية جبنة
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا مارجريتا','Margarita Pizza',null,1,85,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":85,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":115},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":175},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":110},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":150},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":225}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا ميكس تشيز','Mix Cheese Pizza',null,2,105,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":105,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":150},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":215},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":130},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":185},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":265}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا فيجن','Veggie Pizza',null,3,100,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":100,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":145},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":195},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":125},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":180},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":245}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا ايطاليان سوسيدج','Italian Sausage Pizza',null,4,110,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":110,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":145},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":210},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":135},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":180},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":260}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا ببروني','Pepperoni Pizza',null,5,110,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":110,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":145},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":210},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":135},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":180},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":260}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا بسطرمة','Pastrami Pizza',null,6,120,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":120,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":160},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":230},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":145},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":195},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":280}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا تشكن رانش','Chicken Ranch Pizza',null,7,125,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":125,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":170},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":245},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":150},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":205},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":295}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا تشكن باربيكيو','Chicken BBQ Pizza',null,8,125,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":125,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":170},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":245},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":150},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":205},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":295}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا كرسبي تشكن','Crispy Chicken Pizza',null,9,130,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":130,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":180},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":260},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":155},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":215},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":310}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا سوبر بيف','Super Beef Pizza',null,10,135,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":135,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":195},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":265},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":160},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":230},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":315}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا زا برجر','Z Burger Pizza',null,11,145,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":145,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":200},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":270},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":170},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":235},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":320}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا جمبري','Shrimp Pizza',null,12,235,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":235,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":305},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":435},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":260},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":340},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":485}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا سي رانش','Sea Ranch Pizza',null,13,260,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":260,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":340},
      {"ar":"فاميلي 39 سم","en":"Family 39cm","price":475},
      {"ar":"وسط محشي جبنة","en":"Medium Cheese Stuffed","price":280},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":375},
      {"ar":"فاميلي محشي جبنة","en":"Family Cheese Stuffed","price":525}]');

  -- التونة لارج فقط، واوه بيتزا وسط/لارج بدون محشي — حسب المنيو المطبوع
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا تونه','Tuna Pizza',null,14,180,
    '[{"ar":"لارج 30 سم","en":"Large 30cm","price":180,"def":true},
      {"ar":"لارج محشي جبنة","en":"Large Cheese Stuffed","price":215}]');

  perform public._seed_menu_item(r,'بيتزا','Pizza','اوه بيتزا','Oh Pizza',null,15,110,
    '[{"ar":"وسط 25 سم","en":"Medium 25cm","price":110,"def":true},
      {"ar":"لارج 30 سم","en":"Large 30cm","price":140}]');

  -- بيتزا بريميم (سعر واحد)
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا تشيز كرانش','Cheesy Crunch Pizza',
    'بريميم',16,225);
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا بريميم تشيز','Premium Cheese Pizza',
    'بريميم',17,225);
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا تشكن بيستو','Chicken Pesto Pizza',
    'بريميم',18,225);

  -- هاف آند هاف: النص من بيتزا لارج، والربع من بيتزا فاميلي.
  -- الزبون يطلب نصين (لارج) أو 4 أرباع (فاميلي)، فالمطبخ يقرأ
  -- التذكرة كقطع مستقلة وهو بالظبط اللي محتاجه.
  perform public._seed_menu_item(r,'هاف آند هاف','Half & Half','هاف آند هاف ميكس تشيز','Half & Half Mix Cheese',
    'اختر نصين لبيتزا لارج أو 4 أرباع لبيتزا فاميلي',1,75,
    '[{"ar":"نص (لارج)","en":"Half (Large)","price":75,"def":true},{"ar":"ربع (فاميلي)","en":"Quarter (Family)","price":55}]');
  perform public._seed_menu_item(r,'هاف آند هاف','Half & Half','هاف آند هاف ببروني','Half & Half Pepperoni',
    'اختر نصين لبيتزا لارج أو 4 أرباع لبيتزا فاميلي',2,75,
    '[{"ar":"نص (لارج)","en":"Half (Large)","price":75,"def":true},{"ar":"ربع (فاميلي)","en":"Quarter (Family)","price":55}]');
  perform public._seed_menu_item(r,'هاف آند هاف','Half & Half','هاف آند هاف سجق','Half & Half Sausage',
    'اختر نصين لبيتزا لارج أو 4 أرباع لبيتزا فاميلي',3,75,
    '[{"ar":"نص (لارج)","en":"Half (Large)","price":75,"def":true},{"ar":"ربع (فاميلي)","en":"Quarter (Family)","price":55}]');
  perform public._seed_menu_item(r,'هاف آند هاف','Half & Half','هاف آند هاف بسطرمة','Half & Half Pastrami',
    'اختر نصين لبيتزا لارج أو 4 أرباع لبيتزا فاميلي',4,80,
    '[{"ar":"نص (لارج)","en":"Half (Large)","price":80,"def":true},{"ar":"ربع (فاميلي)","en":"Quarter (Family)","price":60}]');
  perform public._seed_menu_item(r,'هاف آند هاف','Half & Half','هاف آند هاف تشكن رانش','Half & Half Chicken Ranch',
    'اختر نصين لبيتزا لارج أو 4 أرباع لبيتزا فاميلي',5,85,
    '[{"ar":"نص (لارج)","en":"Half (Large)","price":85,"def":true},{"ar":"ربع (فاميلي)","en":"Quarter (Family)","price":65}]');
  perform public._seed_menu_item(r,'هاف آند هاف','Half & Half','هاف آند هاف تشكن باربيكيو','Half & Half Chicken BBQ',
    'اختر نصين لبيتزا لارج أو 4 أرباع لبيتزا فاميلي',6,85,
    '[{"ar":"نص (لارج)","en":"Half (Large)","price":85,"def":true},{"ar":"ربع (فاميلي)","en":"Quarter (Family)","price":65}]');
  perform public._seed_menu_item(r,'هاف آند هاف','Half & Half','هاف آند هاف تشكن كرسبي','Half & Half Crispy Chicken',
    'اختر نصين لبيتزا لارج أو 4 أرباع لبيتزا فاميلي',7,90,
    '[{"ar":"نص (لارج)","en":"Half (Large)","price":90,"def":true},{"ar":"ربع (فاميلي)","en":"Quarter (Family)","price":70}]');
  perform public._seed_menu_item(r,'هاف آند هاف','Half & Half','هاف آند هاف زا برجر','Half & Half Za Burger',
    'اختر نصين لبيتزا لارج أو 4 أرباع لبيتزا فاميلي',8,100,
    '[{"ar":"نص (لارج)","en":"Half (Large)","price":100,"def":true},{"ar":"ربع (فاميلي)","en":"Quarter (Family)","price":70}]');
  perform public._seed_menu_item(r,'هاف آند هاف','Half & Half','هاف آند هاف جمبري','Half & Half Shrimp',
    'اختر نصين لبيتزا لارج أو 4 أرباع لبيتزا فاميلي',9,155,
    '[{"ar":"نص (لارج)","en":"Half (Large)","price":155,"def":true},{"ar":"ربع (فاميلي)","en":"Quarter (Family)","price":110}]');
  perform public._seed_menu_item(r,'هاف آند هاف','Half & Half','هاف آند هاف سي رانش','Half & Half Sea Ranch',
    'اختر نصين لبيتزا لارج أو 4 أرباع لبيتزا فاميلي',10,170,
    '[{"ar":"نص (لارج)","en":"Half (Large)","price":170,"def":true},{"ar":"ربع (فاميلي)","en":"Quarter (Family)","price":120}]');

  -- الباستا (وسط / لارج)
  perform public._seed_menu_item(r,'باستا','Pasta','بنا ارابيتا','Penne Arrabbiata',null,1,70,
    '[{"ar":"وسط","en":"Medium","price":70,"def":true},{"ar":"لارج","en":"Large","price":85}]');
  perform public._seed_menu_item(r,'باستا','Pasta','ماك اند تشيز','Mac & Cheese',null,2,95,
    '[{"ar":"وسط","en":"Medium","price":95,"def":true},{"ar":"لارج","en":"Large","price":115}]');
  perform public._seed_menu_item(r,'باستا','Pasta','اسباجتي بونوليز','Spaghetti Bolognese',null,3,120,
    '[{"ar":"وسط","en":"Medium","price":120,"def":true},{"ar":"لارج","en":"Large","price":140}]');
  perform public._seed_menu_item(r,'باستا','Pasta','اورينتال سوسيدج باستا','Oriental Sausage Pasta',null,4,125,
    '[{"ar":"وسط","en":"Medium","price":125,"def":true},{"ar":"لارج","en":"Large","price":155}]');
  perform public._seed_menu_item(r,'باستا','Pasta','الفريدو','Alfredo',null,5,130,
    '[{"ar":"وسط","en":"Medium","price":130,"def":true},{"ar":"لارج","en":"Large","price":150}]');
  perform public._seed_menu_item(r,'باستا','Pasta','كرسبي تشكن باستا','Crispy Chicken Pasta',null,6,130,
    '[{"ar":"وسط","en":"Medium","price":130,"def":true},{"ar":"لارج","en":"Large","price":150}]');
  perform public._seed_menu_item(r,'باستا','Pasta','تشاينيز تشكن باستا','Chinese Chicken Pasta',null,7,135,
    '[{"ar":"وسط","en":"Medium","price":135,"def":true},{"ar":"لارج","en":"Large","price":165}]');
  perform public._seed_menu_item(r,'باستا','Pasta','بنا بستو','Penne Pesto',null,8,140,
    '[{"ar":"وسط","en":"Medium","price":140,"def":true},{"ar":"لارج","en":"Large","price":170}]');
  perform public._seed_menu_item(r,'باستا','Pasta','كاري باستا جمبري','Curry Shrimp Pasta',null,9,250,
    '[{"ar":"وسط","en":"Medium","price":250,"def":true},{"ar":"لارج","en":"Large","price":305}]');
  perform public._seed_menu_item(r,'باستا','Pasta','تشاينيز شيرمب باستا','Chinese Shrimp Pasta',null,10,260,
    '[{"ar":"وسط","en":"Medium","price":260,"def":true},{"ar":"لارج","en":"Large","price":315}]');
  perform public._seed_menu_item(r,'باستا','Pasta','سي فود باستا','Seafood Pasta',null,11,260,
    '[{"ar":"وسط","en":"Medium","price":260,"def":true},{"ar":"لارج","en":"Large","price":315}]');
  perform public._seed_menu_item(r,'باستا','Pasta','كوردون بلو باستا','Cordon Blu Pasta','بريميم',12,225);

  -- الجانبية والسلطات
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','فرايز','Fries',null,1,35);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','اونيون رينجز','Onion Rings',null,2,45);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','كومبو','Combo',null,3,50);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','موتزريلا ستيكس','Mozzarella Sticks',null,4,55);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','تشيز فرايز','Cheese Fries',null,5,65);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','تشيلي فرايز','Chili Fries',null,6,75);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','بارتي تكساس فرايز','Party Texas Fries',null,7,95);
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','بابس ميكس','Pub''s Mix',null,8,175);
  perform public._seed_menu_item(r,'سلطات','Salads','كولسلو','Coleslaw',null,1,35);
  perform public._seed_menu_item(r,'سلطات','Salads','جريك سالاد','Greek Salad',null,2,85);
  perform public._seed_menu_item(r,'سلطات','Salads','تشيكن سالاد','Chicken Salad',null,3,100);

  -- المشروبات
  perform public._seed_menu_item(r,'مشروبات','Drinks','مياه','Water',null,1,10);
  perform public._seed_menu_item(r,'مشروبات','Drinks','سوفت درينك','Soft Drink',null,2,20);
  perform public._seed_menu_item(r,'مشروبات','Drinks','سوفت درينك لتر','Soft Drink 1L',null,3,35);

  -- الإضافات
  perform public._seed_addon_group(r,'الإضافات','Extras',
    '[{"ar":"هالابينو","en":"Jalapeno","price":15},
      {"ar":"كرابس","en":"Crabs","price":20},
      {"ar":"رانش","en":"Ranch","price":20},
      {"ar":"باربكيو","en":"Barbecue","price":20},
      {"ar":"سويت تشيلي","en":"Sweet Chili","price":20},
      {"ar":"تكساس","en":"Texas","price":20},
      {"ar":"مشروم","en":"Mushroom","price":25},
      {"ar":"شيدر صوص","en":"Cheddar Sauce","price":25},
      {"ar":"بيف توبينج","en":"Beef Topping","price":30},
      {"ar":"جريلد تشكن","en":"Grilled Chicken","price":35},
      {"ar":"بسطرمة","en":"Pastrami","price":35},
      {"ar":"بيبروني","en":"Pepperoni","price":35},
      {"ar":"سموكد تركي","en":"Smoked Turkey","price":35},
      {"ar":"كرسبي تشكن","en":"Crispy Chicken","price":35},
      {"ar":"تشيز","en":"Cheese","price":35},
      {"ar":"ميكس تشيز","en":"Mix Cheese","price":40},
      {"ar":"كالاماري","en":"Calamari","price":45},
      {"ar":"بارميزان","en":"Parmesan","price":45},
      {"ar":"روكفورد","en":"Roquefort","price":45},
      {"ar":"جمبري","en":"Shrimp","price":85}]',
    array['بيتزا','هاف آند هاف','باستا']);

end $$;


-- ── 5) Category ordering ──────────────────────────────────────
-- The customer menu tabs follow this order. Categories seeded above
-- got an incremental sort_order in creation order; restate it so the
-- food leads and the drinks trail regardless of insert sequence.
update public.menu_categories set sort_order = v.ord
from (values
  ('برجر',1),('سماش برجر',2),('سندوتشات فراخ',3),('راب',4),
  ('بيتزا',5),('هاف آند هاف',6),('باستا',7),
  ('مقبلات وجانبية',8),('سلطات',9),
  ('وجبات أطفال',10),('عروض ووجبات',11),
  ('دوناتس',12),('كرواسون',13),('مخبوزات وحلويات',14),
  ('كيك وتشيز كيك',15),('ايس كريم',16),('بوكسات',17),
  ('قهوة ساخنة',18),('قهوة باردة',19),('فرابيه وميلك شيك',20),
  ('شاي ومشروبات ساخنة',21),('عصائر وموهيتو',22),('مشروبات',23)
) as v(name, ord)
where public.menu_categories.name_ar = v.name;


-- ── 6) Drop the seeding helpers ───────────────────────────────
drop function if exists public._seed_menu_item(uuid, text, text, text, text, text, integer, numeric, jsonb);
drop function if exists public._seed_addon_group(uuid, text, text, jsonb, text[], integer);
