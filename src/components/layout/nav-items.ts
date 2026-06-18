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
  Send,
  Settings,
  ShoppingCart,
  Smartphone,
  Store,
  Tags,
  Truck,
  Users,
  Utensils,
  FilePenLine,
  LineChart,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages";

export type NavGroup =
  | "main"
  | "management"
  | "operations"
  | "marketing"
  | "system";

export type NavItem = {
  titleKey: MessageKey;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: NavGroup;
};

export const navGroupLabels: Record<NavGroup, { ar: string; en: string }> = {
  main: { ar: "الرئيسية", en: "Overview" },
  management: { ar: "الإدارة", en: "Management" },
  operations: { ar: "العمليات", en: "Operations" },
  marketing: { ar: "التسويق", en: "Marketing" },
  system: { ar: "النظام", en: "System" },
};

export const navGroupOrder: NavGroup[] = [
  "main",
  "management",
  "operations",
  "marketing",
  "system",
];

export const navItems: NavItem[] = [
  { titleKey: "nav.home", href: "/", icon: Home, group: "main" },
  { titleKey: "nav.analytics", href: "/analytics", icon: LineChart, group: "main" },
  { titleKey: "nav.finance", href: "/finance", icon: BarChart3, group: "main" },

  { titleKey: "nav.users", href: "/users", icon: Users, group: "management" },
  { titleKey: "nav.restaurants", href: "/restaurants", icon: Store, group: "management" },
  { titleKey: "nav.branches", href: "/branches", icon: MapPin, group: "management" },
  { titleKey: "nav.categories", href: "/categories", icon: Tags, group: "management" },
  { titleKey: "nav.menuCategories", href: "/menu-categories", icon: Boxes, group: "management" },
  { titleKey: "nav.menuItems", href: "/menu-items", icon: Utensils, group: "management" },
  { titleKey: "nav.menuItemRequests", href: "/menu-item-requests", icon: FilePenLine, group: "management" },

  { titleKey: "nav.orders", href: "/orders", icon: ClipboardList, group: "operations" },
  { titleKey: "nav.orderTracking", href: "/order-tracking", icon: Truck, group: "operations" },
  { titleKey: "nav.cart", href: "/cart", icon: ShoppingCart, group: "operations" },
  { titleKey: "nav.commissions", href: "/commissions", icon: CreditCard, group: "operations" },
  { titleKey: "nav.workingHours", href: "/working-hours", icon: Clock, group: "operations" },

  { titleKey: "nav.offers", href: "/offers", icon: Gift, group: "marketing" },
  { titleKey: "nav.promoCodes", href: "/promo-codes", icon: Percent, group: "marketing" },
  { titleKey: "nav.campaigns", href: "/campaigns", icon: Send, group: "marketing" },
  { titleKey: "nav.whatsapp", href: "/whatsapp", icon: Smartphone, group: "marketing" },
  { titleKey: "nav.reviews", href: "/reviews", icon: MessageSquare, group: "marketing" },
  { titleKey: "nav.favorites", href: "/favorites", icon: Heart, group: "marketing" },

  { titleKey: "nav.queryLab", href: "/query-lab", icon: Database, group: "system" },
  { titleKey: "nav.seedData", href: "/seed", icon: Database, group: "system" },
  { titleKey: "nav.settings", href: "/settings", icon: Settings, group: "system" },
  { titleKey: "nav.deliverySettings", href: "/settings/delivery", icon: Truck, group: "system" },
];
