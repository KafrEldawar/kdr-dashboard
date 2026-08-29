-- ============================================================
-- 080: Seed the menus for Super Pizza and Bab Kabab
--
-- Source of truth for the prices below:
--   • Super Pizza — the 7 blue menu boards (بيتزا / أسماك / فطير
--     حادق / فطائر ميكسات + حلو / كريب / مكرونة / اضافات)
--   • Bab Kabab   — the 2 printed A3 sheets (وجبات الكرم والفتة +
--     المطبخ الشرقى، and سندوتشات + المشاوى)
--
-- Depends on 074 (menu_item_variants / menu_addon_groups) and
-- follows 075 exactly: natural keys everywhere, so re-running this
-- file re-prices in place instead of duplicating the menu. These
-- boards get reprinted, and this file is the diffable record of
-- what the prices were.
--
-- Sizing conventions taken from the printed menus:
--   • Super Pizza — S / M / L on pizza and macaroni; fteer is priced
--     on a 4-way grid وسط / وسط وش بيتزا / لارج / لارج وش بيتزا
--   • Bab Kabab   — sandwiches are the same filling on two breads
--     (عيش ردة / عيش سورى), so the bread is the variant; grills are
--     priced ربع / تلت / نص كيلو, and محاشى ربع / نص كيلو
--
-- Anything printed as "قريبا" is deliberately NOT seeded: those rows
-- carry no price on the sheet, and a price-0 row is sold for free the
-- moment anyone flips is_available on. The owner adds them with a
-- real price from the dashboard when they land.
--
-- Both restaurants are still accepts_online_orders = false, so this
-- is staged and invisible to customers (same as 075).
-- ============================================================


-- ── 0) Seeding helpers (dropped at the end of this file) ──────
-- Byte-identical to 075's pair. 075 drops them at its end, so they
-- have to be recreated here rather than depended on.

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


-- ── 1) Super Pizza ────────────────────────────────────────────
do $$
declare
  r uuid := 'e5a75793-4309-4693-a76f-95714906d762';
begin

  -- ······ البيتزا — جبن (S / M / L) ······
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا مارجريتا','Margherita Pizza',null,1,65,
    '[{"ar":"صغير","en":"Small","price":65,"def":true},{"ar":"وسط","en":"Medium","price":85},{"ar":"كبير","en":"Large","price":140}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا ميكس تشيز','Mix Cheese Pizza',null,2,80,
    '[{"ar":"صغير","en":"Small","price":80,"def":true},{"ar":"وسط","en":"Medium","price":130},{"ar":"كبير","en":"Large","price":210}]');

  -- ······ البيتزا — لحوم ······
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا سجق مفروم','Minced Sausage Pizza',null,3,70,
    '[{"ar":"صغير","en":"Small","price":70,"def":true},{"ar":"وسط","en":"Medium","price":90},{"ar":"كبير","en":"Large","price":150}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا سجق بلدى','Baladi Sausage Pizza',null,4,100,
    '[{"ar":"صغير","en":"Small","price":100,"def":true},{"ar":"وسط","en":"Medium","price":170},{"ar":"كبير","en":"Large","price":240}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا بسطرمة','Pastrami Pizza',null,5,80,
    '[{"ar":"صغير","en":"Small","price":80,"def":true},{"ar":"وسط","en":"Medium","price":130},{"ar":"كبير","en":"Large","price":185}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا مفروم','Minced Beef Pizza',null,6,80,
    '[{"ar":"صغير","en":"Small","price":80,"def":true},{"ar":"وسط","en":"Medium","price":130},{"ar":"كبير","en":"Large","price":185}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا سوسيس','Sausage Pizza',null,7,80,
    '[{"ar":"صغير","en":"Small","price":80,"def":true},{"ar":"وسط","en":"Medium","price":130},{"ar":"كبير","en":"Large","price":185}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا سلامى','Salami Pizza',null,8,80,
    '[{"ar":"صغير","en":"Small","price":80,"def":true},{"ar":"وسط","en":"Medium","price":130},{"ar":"كبير","en":"Large","price":185}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا ميكس لحوم','Mixed Meat Pizza',
    'سجق، مفروم، بسطرمة، سوسيس',9,90,
    '[{"ar":"صغير","en":"Small","price":90,"def":true},{"ar":"وسط","en":"Medium","price":140},{"ar":"كبير","en":"Large","price":220}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا سوبر سموك','Super Smoke Pizza',
    'سجق بلدى، سلامى، بسطرمة، شيلى صوص',10,100,
    '[{"ar":"صغير","en":"Small","price":100,"def":true},{"ar":"وسط","en":"Medium","price":170},{"ar":"كبير","en":"Large","price":240}]');

  -- ······ البيتزا — فراخ ······
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا تشكين اورجنال','Original Chicken Pizza',
    'صدور دجاج',11,85,
    '[{"ar":"صغير","en":"Small","price":85,"def":true},{"ar":"وسط","en":"Medium","price":130},{"ar":"كبير","en":"Large","price":200}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا تشكين رانش','Chicken Ranch Pizza',null,12,95,
    '[{"ar":"صغير","en":"Small","price":95,"def":true},{"ar":"وسط","en":"Medium","price":140},{"ar":"كبير","en":"Large","price":220}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا تشكين باربيكيو','Chicken BBQ Pizza',null,13,95,
    '[{"ar":"صغير","en":"Small","price":95,"def":true},{"ar":"وسط","en":"Medium","price":140},{"ar":"كبير","en":"Large","price":220}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا تشكين سبايسي','Spicy Chicken Pizza',
    'ميكس سويت شيلى وهالبينو',14,95,
    '[{"ar":"صغير","en":"Small","price":95,"def":true},{"ar":"وسط","en":"Medium","price":140},{"ar":"كبير","en":"Large","price":220}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا كرسبى تشكين رانش','Crispy Chicken Ranch Pizza',null,15,100,
    '[{"ar":"صغير","en":"Small","price":100,"def":true},{"ar":"وسط","en":"Medium","price":170},{"ar":"كبير","en":"Large","price":240}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا كرسبى تشكين سبايسي','Crispy Spicy Chicken Pizza',null,16,100,
    '[{"ar":"صغير","en":"Small","price":100,"def":true},{"ar":"وسط","en":"Medium","price":170},{"ar":"كبير","en":"Large","price":240}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا سوبر تشكين','Super Chicken Pizza',
    'فراخ، كرسبى، مشروم، رانش صوص',17,100,
    '[{"ar":"صغير","en":"Small","price":100,"def":true},{"ar":"وسط","en":"Medium","price":170},{"ar":"كبير","en":"Large","price":240}]');

  -- ······ البيتزا — أسماك ······
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا تونة','Tuna Pizza',null,18,100,
    '[{"ar":"صغير","en":"Small","price":100,"def":true},{"ar":"وسط","en":"Medium","price":170},{"ar":"كبير","en":"Large","price":240}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا جمبرى','Shrimp Pizza',null,19,150,
    '[{"ar":"صغير","en":"Small","price":150,"def":true},{"ar":"وسط","en":"Medium","price":230},{"ar":"كبير","en":"Large","price":300}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا سى فود','Seafood Pizza',
    'جمبرى، سبيط، كابوريا',20,170,
    '[{"ar":"صغير","en":"Small","price":170,"def":true},{"ar":"وسط","en":"Medium","price":250},{"ar":"كبير","en":"Large","price":330}]');
  perform public._seed_menu_item(r,'بيتزا','Pizza','بيتزا سى رانش','Sea Ranch Pizza',
    'جمبرى كرسبى، كابوريا، كريمى رانش',21,170,
    '[{"ar":"صغير","en":"Small","price":170,"def":true},{"ar":"وسط","en":"Medium","price":250},{"ar":"كبير","en":"Large","price":330}]');

  -- ······ الفطير الحادق ······
  -- الشبكة الرباعية: وسط / وسط وش بيتزا / لارج / لارج وش بيتزا
  perform public._seed_menu_item(r,'فطير','Fteer','فطير سجق مفروم','Minced Sausage Fteer',
    'سجق مفروم متبل + موزاريلا + رومى + خضروات',1,85,
    '[{"ar":"وسط","en":"Medium","price":85,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":120},
      {"ar":"لارج","en":"Large","price":150},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":210}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير سجق بلدى','Baladi Sausage Fteer',
    'سجق لحم بلدى 100% + موزاريلا + رومى + خضروات',2,170,
    '[{"ar":"وسط","en":"Medium","price":170,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":200},
      {"ar":"لارج","en":"Large","price":260},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":320}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير روزبيف بلدى','Baladi Roast Beef Fteer',
    'قطع لحم روزبيف او فلتو + موزاريلا + رومى + خضروات',3,180,
    '[{"ar":"وسط","en":"Medium","price":180,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":210},
      {"ar":"لارج","en":"Large","price":270},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":300}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير بسطرمة','Pastrami Fteer',
    'بسطرمة + اكسترا موزاريلا + رومى + خضروات',4,130,
    '[{"ar":"وسط","en":"Medium","price":130,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":160},
      {"ar":"لارج","en":"Large","price":220},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":280}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير سلامى','Salami Fteer',
    'سلامى + اكسترا موزاريلا + رومى + خضروات',5,130,
    '[{"ar":"وسط","en":"Medium","price":130,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":160},
      {"ar":"لارج","en":"Large","price":220},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":280}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير مفروم','Minced Beef Fteer',
    'لحم مفروم + موزاريلا + رومى + خضروات',6,130,
    '[{"ar":"وسط","en":"Medium","price":130,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":160},
      {"ar":"لارج","en":"Large","price":220},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":280}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير سوسيس','Sausage Fteer',
    'سوسيس + موزاريلا + رومى + خضروات',7,130,
    '[{"ar":"وسط","en":"Medium","price":130,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":160},
      {"ar":"لارج","en":"Large","price":220},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":280}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير تشكين اورجنال','Original Chicken Fteer',
    'صدور دجاج + موزاريلا + رومى + خضروات',8,130,
    '[{"ar":"وسط","en":"Medium","price":130,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":160},
      {"ar":"لارج","en":"Large","price":220},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":280}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير تشكين رانش','Chicken Ranch Fteer',
    'صدور دجاج + موزاريلا + رومى + خضروات + كريمى رانش',9,140,
    '[{"ar":"وسط","en":"Medium","price":140,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":170},
      {"ar":"لارج","en":"Large","price":230},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":290}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير تشكين سبايسي','Spicy Chicken Fteer',
    'صدور دجاج + موزاريلا + رومى + خضروات + هاليبنو + شيلى',10,140,
    '[{"ar":"وسط","en":"Medium","price":140,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":170},
      {"ar":"لارج","en":"Large","price":230},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":290}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير تشكين كرسبى','Crispy Chicken Fteer',
    'فراخ كرسبى + موزاريلا + رومى + خضروات + هاليبنو + شيلى',11,170,
    '[{"ar":"وسط","en":"Medium","price":170,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":200},
      {"ar":"لارج","en":"Large","price":260},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":320}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير تونة','Tuna Fteer',
    'تونة + اكسترا موزاريلا + رومى + خضروات',12,170,
    '[{"ar":"وسط","en":"Medium","price":170,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":200},
      {"ar":"لارج","en":"Large","price":240},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":300}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير جمبرى','Shrimp Fteer',
    'جمبرى + موزاريلا + رومى + خضروات',13,260,
    '[{"ar":"وسط","en":"Medium","price":260,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":290},
      {"ar":"لارج","en":"Large","price":350},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":410}]');

  -- فطائر حادق ميكسات
  perform public._seed_menu_item(r,'فطير','Fteer','فطير سجق كيرى بسطرمة','Sausage Kiri Pastrami Fteer',
    'سجق + بسطرمة + كيرى + موزاريلا + رومى + خضروات',14,140,
    '[{"ar":"وسط","en":"Medium","price":140,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":170},
      {"ar":"لارج","en":"Large","price":230},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":290}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير ميكس لحوم','Mixed Meat Fteer',
    'سجق + بسطرمة + مفروم + سوسيس + موزاريلا + رومى + خضروات',15,140,
    '[{"ar":"وسط","en":"Medium","price":140,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":170},
      {"ar":"لارج","en":"Large","price":230},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":290}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير سوبر سموك','Super Smoke Fteer',
    'سجق بلدى + بسطرمة + سلامى + كيرى + موزاريلا + رومى + خضروات',16,180,
    '[{"ar":"وسط","en":"Medium","price":180,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":210},
      {"ar":"لارج","en":"Large","price":270},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":330}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير ميكس تشيز','Mix Cheese Fteer',
    'كيرى + مثلثات + ميكس جبن + صوص تشيزى + موزاريلا + رومى + خضروات',17,130,
    '[{"ar":"وسط","en":"Medium","price":130,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":160},
      {"ar":"لارج","en":"Large","price":220},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":280}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير فراخ بسطرمة كيرى','Chicken Pastrami Kiri Fteer',
    'صدور فراخ + بسطرمة + كيرى + موزاريلا + رومى + خضروات',18,180,
    '[{"ar":"وسط","en":"Medium","price":180,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":210},
      {"ar":"لارج","en":"Large","price":270},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":330}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير سوبر تشكين','Super Chicken Fteer',
    'صدور دجاج + كرسبى + مشروم + موزاريلا + رومى + خضروات',19,200,
    '[{"ar":"وسط","en":"Medium","price":200,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":230},
      {"ar":"لارج","en":"Large","price":300},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":360}]');
  perform public._seed_menu_item(r,'فطير','Fteer','فطير سى فود','Seafood Fteer',
    'جمبرى + كاليمارى + كابوريا + موزاريلا + رومى + خضروات',20,270,
    '[{"ar":"وسط","en":"Medium","price":270,"def":true},{"ar":"وسط وش بيتزا","en":"Medium Pizza-Top","price":300},
      {"ar":"لارج","en":"Large","price":370},{"ar":"لارج وش بيتزا","en":"Large Pizza-Top","price":430}]');

  -- ······ فطائر الحلو + سبريد ······
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير كاستر','Custard Fteer',null,1,40);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير كاستر موز','Custard Banana Fteer',null,2,60);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير ملوكى','Molouki Fteer',
    'زبيب وجوز هند',3,65);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير بغاشة','Boghasha Fteer',
    'جوز هند وعسل',4,65);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير شوكلاتة','Chocolate Fteer',null,5,85);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير لوتس','Lotus Fteer',null,6,85);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير شوكلاتة موز','Chocolate Banana Fteer',null,7,95);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير قشطة بلدى وعسل','Cream & Honey Fteer',null,8,95);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير ميكس مكسرات','Mixed Nuts Fteer',
    'بندق - فستق - كاجو - لوز',9,130);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير نوتيلا بيور','Nutella Pure Fteer',null,10,150);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير قشطة بلدى وعسل ومكسرات','Cream Honey & Nuts Fteer',
    'بندق - فستق - كاجو - لوز',11,150);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير سوبر بيور','Super Pure Fteer',
    'نص نوتيلا بيور + نص لوتس بيور',12,160);
  perform public._seed_menu_item(r,'فطائر حلو','Sweet Fteer','فطير لوتس بيور','Lotus Pure Fteer',null,13,180);

  -- ······ الكريب الحادق ······
  perform public._seed_menu_item(r,'كريب','Crepe','كريب موزاريلا','Mozzarella Crepe',null,1,60);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب بطاطس','Potato Crepe',null,2,65);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب سجق مفروم','Minced Sausage Crepe',null,3,70);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب لحم مفروم','Minced Beef Crepe',null,4,85);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب فراخ','Chicken Crepe',null,5,85);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب بسطرمة','Pastrami Crepe',null,6,85);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب سوسيس','Sausage Crepe',null,7,85);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب ميكس تشيز','Mix Cheese Crepe',
    'كيرى، رومى، مثلثات، موزاريلا',8,85);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب سجق بلدى','Baladi Sausage Crepe',null,9,95);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب ميكس لحوم','Mixed Meat Crepe',
    'سجق، مفروم، سوسيس، بسطرمة',10,95);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب فراخ رانش','Chicken Ranch Crepe',null,11,95);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب فراخ باربيكيو','Chicken BBQ Crepe',null,12,95);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب فراخ كرسبى','Crispy Chicken Crepe',null,13,95);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب سوبر سموك','Super Smoke Crepe',
    'سجق بلدى، سوسيس، بسطرمة، سلامى',14,120);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب جمبرى','Shrimp Crepe',null,15,145);
  perform public._seed_menu_item(r,'كريب','Crepe','كريب سى فود','Seafood Crepe',
    'جمبرى، سبيط، كابوريا',16,165);

  -- ······ الكريب الحلو ······
  perform public._seed_menu_item(r,'كريب حلو','Sweet Crepe','كريب شوكلاتة','Chocolate Crepe',null,1,50);
  perform public._seed_menu_item(r,'كريب حلو','Sweet Crepe','كريب شوكلاتة موز','Chocolate Banana Crepe',null,2,70);
  perform public._seed_menu_item(r,'كريب حلو','Sweet Crepe','كريب شوكلاتة أوريو','Chocolate Oreo Crepe',null,3,75);
  perform public._seed_menu_item(r,'كريب حلو','Sweet Crepe','كريب شوكلاتة هوهوز','Chocolate Ho-Hos Crepe',null,4,75);
  perform public._seed_menu_item(r,'كريب حلو','Sweet Crepe','كريب نوتيلا','Nutella Crepe',null,5,90);
  perform public._seed_menu_item(r,'كريب حلو','Sweet Crepe','كريب نوتيلا موز','Nutella Banana Crepe',null,6,100);

  -- ······ المكرونة (S / M / L) ······
  -- كل المكرونات: مكرونة بنية + وايت صوص + وش موزاريلا
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة سجق','Sausage Macaroni',
    'مكرونة بنية + وايت صوص + وش موزاريلا',1,70,
    '[{"ar":"صغير","en":"Small","price":70,"def":true},{"ar":"وسط","en":"Medium","price":95},{"ar":"كبير","en":"Large","price":150}]');
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة فراخ','Chicken Macaroni',
    'مكرونة بنية + وايت صوص + وش موزاريلا',2,75,
    '[{"ar":"صغير","en":"Small","price":75,"def":true},{"ar":"وسط","en":"Medium","price":100},{"ar":"كبير","en":"Large","price":160}]');
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة مفروم','Minced Beef Macaroni',
    'مكرونة بنية + وايت صوص + وش موزاريلا',3,75,
    '[{"ar":"صغير","en":"Small","price":75,"def":true},{"ar":"وسط","en":"Medium","price":100},{"ar":"كبير","en":"Large","price":160}]');
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة بسطرمة','Pastrami Macaroni',
    'مكرونة بنية + وايت صوص + وش موزاريلا',4,75,
    '[{"ar":"صغير","en":"Small","price":75,"def":true},{"ar":"وسط","en":"Medium","price":100},{"ar":"كبير","en":"Large","price":160}]');
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة نجرسكو','Negresco Macaroni',
    'مكرونة بنية + وايت صوص + وش موزاريلا',5,80,
    '[{"ar":"صغير","en":"Small","price":80,"def":true},{"ar":"وسط","en":"Medium","price":110},{"ar":"كبير","en":"Large","price":170}]');
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة ميكس لحوم','Mixed Meat Macaroni',
    'سجق، مفروم، بسطرمة، سوسيس',6,80,
    '[{"ar":"صغير","en":"Small","price":80,"def":true},{"ar":"وسط","en":"Medium","price":110},{"ar":"كبير","en":"Large","price":170}]');
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة سجق بلدى','Baladi Sausage Macaroni',
    'مكرونة بنية + وايت صوص + وش موزاريلا',7,100,
    '[{"ar":"صغير","en":"Small","price":100,"def":true},{"ar":"وسط","en":"Medium","price":150},{"ar":"كبير","en":"Large","price":220}]');
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة جمبرى','Shrimp Macaroni',
    'مكرونة بنية + وايت صوص + وش موزاريلا',8,130,
    '[{"ar":"صغير","en":"Small","price":130,"def":true},{"ar":"وسط","en":"Medium","price":180},{"ar":"كبير","en":"Large","price":240}]');
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة سى فود','Seafood Macaroni',
    'جمبرى، سبيط، كابوريا',9,150,
    '[{"ar":"صغير","en":"Small","price":150,"def":true},{"ar":"وسط","en":"Medium","price":200},{"ar":"كبير","en":"Large","price":260}]');

  -- مكرونات سوبر كريمى (سعر واحد)
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة الفريدو رانش','Alfredo Ranch Macaroni',
    'صدور فراخ + مشروم + هاليبنو + وايت صوص + بارميزان + كريمى رانش',10,150);
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة كرسبى رانش','Crispy Ranch Macaroni',
    'فراخ كرسبى + هاليبنو + وايت صوص + بارميزان + كريمى رانش',11,170);
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة كرسبى شيدر','Crispy Cheddar Macaroni',
    'فراخ كرسبى + مشروم + هاليبنو + وايت صوص + بارميزان + كريمى رانش',12,170);
  perform public._seed_menu_item(r,'مكرونة','Macaroni','مكرونة جمبرى كرسبى شيدر','Crispy Shrimp Cheddar Macaroni',
    'جمبرى كرسبى + مشروم + هاليبنو + وايت صوص + بارميزان + كريمى رانش',13,250);

  -- ······ جانبية ومشروبات ······
  -- من لوحة الاضافات، لكن دول بيتطلبوا لوحدهم فبقوا أصناف مش إضافات
  perform public._seed_menu_item(r,'مقبلات وجانبية','Appetizers & Sides','باكيت بطاطس فارم','Farm Fries Pack',null,1,35);
  perform public._seed_menu_item(r,'مشروبات','Drinks','كان بيبسي','Pepsi Can',null,1,20);
  perform public._seed_menu_item(r,'مشروبات','Drinks','كان سفن أب','7UP Can',null,2,20);
  perform public._seed_menu_item(r,'مشروبات','Drinks','كان كولا','Cola Can',null,3,20);

  -- ······ الإضافات ······
  perform public._seed_addon_group(r,'الإضافات','Extras',
    '[{"ar":"كيرى (قطعة)","en":"Kiri (piece)","price":15},
      {"ar":"هاليبنو","en":"Jalapeno","price":15},
      {"ar":"ريمكل باربيكيو","en":"BBQ Dip","price":15},
      {"ar":"ريمكل شيلى","en":"Chili Dip","price":15},
      {"ar":"موزاريلا","en":"Mozzarella","price":20},
      {"ar":"ريمكل رانش","en":"Ranch Dip","price":25},
      {"ar":"ريمكل شيدر","en":"Cheddar Dip","price":25},
      {"ar":"لحوم","en":"Meat","price":30},
      {"ar":"مشروم","en":"Mushroom","price":30},
      {"ar":"فراخ","en":"Chicken","price":35},
      {"ar":"كرسبى","en":"Crispy","price":40},
      {"ar":"جمبرى","en":"Shrimp","price":60}]',
    array['بيتزا','فطير','كريب','مكرونة']);

  -- المكسرات إضافة للحلو بس — عشان محدش يضيف جمبرى على كريب نوتيلا
  perform public._seed_addon_group(r,'إضافات الحلو','Sweet Extras',
    '[{"ar":"مكسرات","en":"Mixed Nuts","price":65}]',
    array['فطائر حلو','كريب حلو']);

  -- حشو الأطراف للبيتزا: اختيار واحد بحد أقصى
  perform public._seed_addon_group(r,'حشو الأطراف','Stuffed Crust',
    '[{"ar":"حشو اطراف وسط","en":"Medium Stuffed Crust","price":40},
      {"ar":"حشو اطراف كبير","en":"Large Stuffed Crust","price":65}]',
    array['بيتزا'], 1);

end $$;


-- ── 2) Bab Kabab ──────────────────────────────────────────────
do $$
declare
  r uuid := '88855694-7fff-465d-9915-bb4733df184f';
begin

  -- ······ وجبات الكرم ······
  perform public._seed_menu_item(r,'وجبات الكرم','Karam Meals','وجبة كفتة بلدى','Baladi Kofta Meal',null,1,155);
  perform public._seed_menu_item(r,'وجبات الكرم','Karam Meals','وجبة شيش وكفتة','Shish & Kofta Meal',null,2,155);
  perform public._seed_menu_item(r,'وجبات الكرم','Karam Meals','وجبة شيش فراخ','Chicken Shish Meal',null,3,155);
  -- المنيو المطبوع بيكرر "وجبة شيش وكفتة" فى الصف الرابع — تكرار
  -- فى الطباعة، مش صنف تانى، فاتشال.
  perform public._seed_menu_item(r,'وجبات الكرم','Karam Meals','وجبة ربع فرخة ورك مع كفتة','Quarter Leg & Kofta Meal',null,4,155);
  perform public._seed_menu_item(r,'وجبات الكرم','Karam Meals','وجبة ربع فرخة صدر مع كفتة','Quarter Breast & Kofta Meal',null,5,175);
  perform public._seed_menu_item(r,'وجبات الكرم','Karam Meals','وجبة ميكس لحوم','Mixed Meat Meal',null,6,275);

  -- ······ الفتة السورى والطعم البلدى ······
  perform public._seed_menu_item(r,'فتة','Fatteh','فتة ربع فرخة ورك','Quarter Leg Fatteh',null,1,130);
  perform public._seed_menu_item(r,'فتة','Fatteh','فتة ربع فرخة صدر','Quarter Breast Fatteh',null,2,145);
  perform public._seed_menu_item(r,'فتة','Fatteh','فتة شيش فراخ','Chicken Shish Fatteh',null,3,130);
  perform public._seed_menu_item(r,'فتة','Fatteh','فتة سجق بلدى','Baladi Sausage Fatteh',null,4,130);
  perform public._seed_menu_item(r,'فتة','Fatteh','فتة كفتة بلدى','Baladi Kofta Fatteh',null,5,130);
  perform public._seed_menu_item(r,'فتة','Fatteh','فتة طرب بلدى','Baladi Tarab Fatteh',null,6,200);
  perform public._seed_menu_item(r,'فتة','Fatteh','فتة أنتركوت بلدى','Baladi Entrecote Fatteh',null,7,200);
  perform public._seed_menu_item(r,'فتة','Fatteh','فتة كباب فلتو بلدى','Baladi Filet Kebab Fatteh',null,8,230);

  -- ······ المشاوى — لحوم بلدى (ربع / تلت / نص كيلو) ······
  -- الأسعار دى أسعار العرض المطبوعة (الرقم الكبير)، مش الأسعار
  -- المشطوبة اللى فوقها.
  perform public._seed_menu_item(r,'مشاوى','Grills','شيش فراخ رانش','Ranch Chicken Shish',
    'يقدم مع رز ومحشى وسلطات وعيش وبطاطس',1,155,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":155,"def":true},{"ar":"تلت كيلو","en":"Third Kilo","price":190},{"ar":"نص كيلو","en":"Half Kilo","price":240}]');
  perform public._seed_menu_item(r,'مشاوى','Grills','مشكل شيش وكفتة','Mixed Shish & Kofta',
    'يقدم مع رز ومحشى وسلطات وعيش وبطاطس',2,190,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":190,"def":true},{"ar":"تلت كيلو","en":"Third Kilo","price":225},{"ar":"نص كيلو","en":"Half Kilo","price":275}]');
  perform public._seed_menu_item(r,'مشاوى','Grills','كفتة بلدى','Baladi Kofta',
    'يقدم مع رز ومحشى وسلطات وعيش وبطاطس',3,205,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":205,"def":true},{"ar":"تلت كيلو","en":"Third Kilo","price":255},{"ar":"نص كيلو","en":"Half Kilo","price":325}]');
  perform public._seed_menu_item(r,'مشاوى','Grills','مشكل كباب وكفتة','Mixed Kebab & Kofta',
    'يقدم مع رز ومحشى وسلطات وعيش وبطاطس',4,210,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":210,"def":true},{"ar":"تلت كيلو","en":"Third Kilo","price":275},{"ar":"نص كيلو","en":"Half Kilo","price":375}]');
  -- الميكس جريل مالوش تلت كيلو فى المنيو المطبوع
  perform public._seed_menu_item(r,'مشاوى','Grills','ميكس جريل','Mixed Grill',
    'انتركوت - شيش - طرب - كفتة، يقدم مع رز ومحشى وسلطات وعيش وبطاطس',5,235,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":235,"def":true},{"ar":"نص كيلو","en":"Half Kilo","price":375}]');
  perform public._seed_menu_item(r,'مشاوى','Grills','سجق بلدى','Baladi Sausage',
    'يقدم مع رز ومحشى وسلطات وعيش وبطاطس',6,250,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":250,"def":true},{"ar":"تلت كيلو","en":"Third Kilo","price":320},{"ar":"نص كيلو","en":"Half Kilo","price":405}]');
  perform public._seed_menu_item(r,'مشاوى','Grills','أنتركوت بلدى','Baladi Entrecote',
    'روزبيف بلدى، يقدم مع رز ومحشى وسلطات وعيش وبطاطس',7,275,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":275,"def":true},{"ar":"تلت كيلو","en":"Third Kilo","price":330},{"ar":"نص كيلو","en":"Half Kilo","price":440}]');
  perform public._seed_menu_item(r,'مشاوى','Grills','كباب بلدى','Baladi Kebab',
    'عرق فيليتو بلدى، يقدم مع رز ومحشى وسلطات وعيش وبطاطس',8,275,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":275,"def":true},{"ar":"تلت كيلو","en":"Third Kilo","price":330},{"ar":"نص كيلو","en":"Half Kilo","price":440}]');
  perform public._seed_menu_item(r,'مشاوى','Grills','طرب بلدى','Baladi Tarab',
    'مضبل ولحم مفروم بلدى، يقدم مع رز ومحشى وسلطات وعيش وبطاطس',9,295,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":295,"def":true},{"ar":"تلت كيلو","en":"Third Kilo","price":370},{"ar":"نص كيلو","en":"Half Kilo","price":490}]');
  perform public._seed_menu_item(r,'مشاوى','Grills','ريش ضانى','Lamb Chops',
    'ريش ضانى بلدى، يقدم مع رز ومحشى وسلطات وعيش وبطاطس',10,300,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":300,"def":true},{"ar":"تلت كيلو","en":"Third Kilo","price":450},{"ar":"نص كيلو","en":"Half Kilo","price":600}]');

  -- مشويات فراخ (ربع ورك / ربع صدر / نص فرخة / فرخة كاملة)
  perform public._seed_menu_item(r,'مشاوى','Grills','فرخة جامبو','Jumbo Chicken',
    '2 كيلو و200 جرام قبل الذبح، تقدم مع رز ومحشى وسلطات وعيش وبطاطس',11,130,
    '[{"ar":"ربع ورك","en":"Quarter Leg","price":130,"def":true},{"ar":"ربع صدر","en":"Quarter Breast","price":145},
      {"ar":"نص فرخة","en":"Half Chicken","price":195},{"ar":"فرخة كاملة","en":"Whole Chicken","price":390}]');
  perform public._seed_menu_item(r,'مشاوى','Grills','فرخة كوكو','Coco Chicken',
    '1 كيلو و600 جرام قبل الذبح، تقدم مع رز ومحشى وسلطات وعيش وبطاطس',12,315,
    '[{"ar":"فرخة كاملة","en":"Whole Chicken","price":315,"def":true}]');

  -- ······ السندوتشات (عيش ردة / عيش سورى) ······
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش بطاطس','Potato Sandwich',null,1,15,
    '[{"ar":"عيش ردة","en":"Bran Bread","price":15,"def":true},{"ar":"عيش سورى","en":"Syrian Bread","price":15}]');
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش بطاطس لحمة مفرومة','Minced Beef Potato Sandwich',null,2,45,
    '[{"ar":"عيش ردة","en":"Bran Bread","price":45,"def":true},{"ar":"عيش سورى","en":"Syrian Bread","price":80}]');
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش شيش فراخ','Chicken Shish Sandwich',null,3,60,
    '[{"ar":"عيش ردة","en":"Bran Bread","price":60,"def":true},{"ar":"عيش سورى","en":"Syrian Bread","price":120}]');
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش كفتة بلدى','Baladi Kofta Sandwich',null,4,65,
    '[{"ar":"عيش ردة","en":"Bran Bread","price":65,"def":true},{"ar":"عيش سورى","en":"Syrian Bread","price":120}]');
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش كفتة صوص شيدر','Cheddar Kofta Sandwich',null,5,80,
    '[{"ar":"عيش ردة","en":"Bran Bread","price":80,"def":true},{"ar":"عيش سورى","en":"Syrian Bread","price":145}]');
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش سجق بلدى','Baladi Sausage Sandwich',null,6,75,
    '[{"ar":"عيش ردة","en":"Bran Bread","price":75,"def":true},{"ar":"عيش سورى","en":"Syrian Bread","price":130}]');
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش أنتركوت بلدى','Baladi Entrecote Sandwich',null,7,90,
    '[{"ar":"عيش ردة","en":"Bran Bread","price":90,"def":true},{"ar":"عيش سورى","en":"Syrian Bread","price":175}]');
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش طرب بلدى','Baladi Tarab Sandwich',null,8,105,
    '[{"ar":"عيش ردة","en":"Bran Bread","price":105,"def":true},{"ar":"عيش سورى","en":"Syrian Bread","price":200}]');
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش كباب بلدى','Baladi Kebab Sandwich',null,9,105,
    '[{"ar":"عيش ردة","en":"Bran Bread","price":105,"def":true},{"ar":"عيش سورى","en":"Syrian Bread","price":200}]');
  -- الصنفين دول مالهمش مقابل على العيش التانى فى المنيو المطبوع
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش بطاطس شيدر','Cheddar Potato Sandwich',
    'على عيش ردة',10,25);
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش بطاطس موتزاريلا','Mozzarella Potato Sandwich',
    'على عيش سورى',11,40);
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','سندوتش ربع فرخة صدر','Quarter Breast Sandwich',null,12,125);
  perform public._seed_menu_item(r,'سندوتشات','Sandwiches','حواوشى دائرى','Round Hawawshi',
    'يقدم على صينى',13,75);

  -- ······ المطبخ الشرقى — ركن الأكلات الحرشة ······
  perform public._seed_menu_item(r,'أكلات شرقية','Oriental Dishes','فرد حمام محشى رز','Stuffed Pigeon with Rice',null,1,195);
  perform public._seed_menu_item(r,'أكلات شرقية','Oriental Dishes','طاجن لحمة بالبصل','Beef & Onion Tagine',null,2,225);
  perform public._seed_menu_item(r,'أكلات شرقية','Oriental Dishes','طاجن لحمة لسان','Tongue Tagine',null,3,225);
  perform public._seed_menu_item(r,'أكلات شرقية','Oriental Dishes','وجبة حمام محشى','Stuffed Pigeon Meal',null,4,225);
  perform public._seed_menu_item(r,'أكلات شرقية','Oriental Dishes','طاجن بطاطس باللحمة','Potato & Beef Tagine',null,5,235);
  perform public._seed_menu_item(r,'أكلات شرقية','Oriental Dishes','طاجن ورق عنب بكوارع','Vine Leaves & Trotters Tagine',null,6,245);
  perform public._seed_menu_item(r,'أكلات شرقية','Oriental Dishes','ورقة لحمة','Waraet Lahma',null,7,285);
  -- موزة ضانى / طاجن عكاوى / نص بطة معلمين "قريبا" على المنيو
  -- المطبوع ولسه مالهمش سعر، فمش متسجلين هنا خالص. لو اتسجلوا
  -- بسعر 0 هيبقى أول واحد يفتح is_available يبيعهم ببلاش.

  -- ······ ركن الشربة ······
  -- شوربة العدس وكريمة الفراخ وكوارع وحمام كلهم "قريبا" ومالهمش
  -- سعر — نفس السبب اللى فوق.
  perform public._seed_menu_item(r,'شوربة','Soups','شوربة لسان عصفور','Orzo Soup',null,1,35);
  perform public._seed_menu_item(r,'شوربة','Soups','طاجن ملوخية','Molokhia Tagine',null,2,65);

  -- ······ ركن المحاشى والمقبلات (ربع / نص كيلو) ······
  perform public._seed_menu_item(r,'محاشى ومقبلات','Stuffed & Starters','محشى ورق عنب','Stuffed Vine Leaves',null,1,75,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":75,"def":true},{"ar":"نص كيلو","en":"Half Kilo","price":150}]');
  perform public._seed_menu_item(r,'محاشى ومقبلات','Stuffed & Starters','محشى كرنب','Stuffed Cabbage',null,2,65,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":65,"def":true},{"ar":"نص كيلو","en":"Half Kilo","price":130}]');
  perform public._seed_menu_item(r,'محاشى ومقبلات','Stuffed & Starters','ممبار بلدى','Baladi Mombar',null,3,120,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":120,"def":true},{"ar":"نص كيلو","en":"Half Kilo","price":210}]');
  perform public._seed_menu_item(r,'محاشى ومقبلات','Stuffed & Starters','سمبوسك جبنة','Cheese Sambousek',null,4,80,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":80,"def":true},{"ar":"نص كيلو","en":"Half Kilo","price":155}]');
  perform public._seed_menu_item(r,'محاشى ومقبلات','Stuffed & Starters','سمبوسك لحمة','Meat Sambousek',null,5,120,
    '[{"ar":"ربع كيلو","en":"Quarter Kilo","price":120,"def":true},{"ar":"نص كيلو","en":"Half Kilo","price":200}]');

end $$;


-- ── 3) Badges for the boxed items on the printed menus ────────
-- الأصناف اللى معلمة فى بوكسات حمرا على المنيو المطبوع.
update public.menu_items
set badge_type = 'custom', badge_label_ar = 'وجبة كبيرة', updated_at = now()
where restaurant_id = '88855694-7fff-465d-9915-bb4733df184f'
  and name_ar = 'وجبة ميكس لحوم';

update public.menu_items
set badge_type = 'custom', badge_label_ar = 'منتج مميز', updated_at = now()
where restaurant_id = '88855694-7fff-465d-9915-bb4733df184f'
  and name_ar in ('سندوتش ربع فرخة صدر', 'حواوشى دائرى');


-- ── 4) Category ordering ──────────────────────────────────────
-- Restates the whole taxonomy so the new categories slot in next to
-- their neighbours instead of trailing in creation order.
update public.menu_categories set sort_order = v.ord
from (values
  ('برجر',1),('سماش برجر',2),('سندوتشات فراخ',3),('راب',4),
  ('بيتزا',5),('هاف آند هاف',6),('فطير',7),('كريب',8),
  ('مكرونة',9),('باستا',10),
  ('مشاوى',11),('وجبات الكرم',12),('فتة',13),('أكلات شرقية',14),
  ('شوربة',15),('محاشى ومقبلات',16),('سندوتشات',17),
  ('مقبلات وجانبية',18),('سلطات',19),
  ('وجبات أطفال',20),('عروض ووجبات',21),
  ('فطائر حلو',22),('كريب حلو',23),
  ('دوناتس',24),('كرواسون',25),('مخبوزات وحلويات',26),
  ('كيك وتشيز كيك',27),('ايس كريم',28),('بوكسات',29),
  ('قهوة ساخنة',30),('قهوة باردة',31),('فرابيه وميلك شيك',32),
  ('شاي ومشروبات ساخنة',33),('عصائر وموهيتو',34),('مشروبات',35)
) as v(name, ord)
where public.menu_categories.name_ar = v.name;


-- ── 5) Drop the seeding helpers ───────────────────────────────
drop function if exists public._seed_menu_item(uuid, text, text, text, text, text, integer, numeric, jsonb);
drop function if exists public._seed_addon_group(uuid, text, text, jsonb, text[], integer);
