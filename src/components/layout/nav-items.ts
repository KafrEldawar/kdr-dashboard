import {
  BarChart3,
  Boxes,
  Clock,
  ClipboardList,
  CreditCard,
  Database,
  Gift,
  Heart,
  Home,
  MapPin,
  MessageSquare,
  Percent,
  Settings,
  ShoppingCart,
  Store,
  Tags,
  Truck,
  Users,
  Utensils,
  FilePenLine,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages";

export type NavItem = {
  titleKey: MessageKey;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

export const navItems: NavItem[] = [
  { titleKey: "nav.home", href: "/", icon: Home },
  { titleKey: "nav.users", href: "/users", icon: Users },
  { titleKey: "nav.restaurants", href: "/restaurants", icon: Store },
  { titleKey: "nav.branches", href: "/branches", icon: MapPin },
  { titleKey: "nav.categories", href: "/categories", icon: Tags },
  { titleKey: "nav.menuCategories", href: "/menu-categories", icon: Boxes },
  { titleKey: "nav.menuItems", href: "/menu-items", icon: Utensils },
  { titleKey: "nav.menuItemRequests", href: "/menu-item-requests", icon: FilePenLine },
  { titleKey: "nav.orders", href: "/orders", icon: ClipboardList },
  { titleKey: "nav.orderTracking", href: "/order-tracking", icon: Truck },
  { titleKey: "nav.offers", href: "/offers", icon: Gift },
  { titleKey: "nav.promoCodes", href: "/promo-codes", icon: Percent },
  { titleKey: "nav.reviews", href: "/reviews", icon: MessageSquare },
  { titleKey: "nav.favorites", href: "/favorites", icon: Heart },
  { titleKey: "nav.cart", href: "/cart", icon: ShoppingCart },
  { titleKey: "nav.commissions", href: "/commissions", icon: CreditCard },
  { titleKey: "nav.finance", href: "/finance", icon: BarChart3 },
  { titleKey: "nav.workingHours", href: "/working-hours", icon: Clock },
  { titleKey: "nav.analytics", href: "/analytics", icon: BarChart3 },
  { titleKey: "nav.queryLab", href: "/query-lab", icon: Database },
  { titleKey: "nav.seedData", href: "/seed", icon: Database },
  { titleKey: "nav.settings", href: "/settings", icon: Settings },
];
