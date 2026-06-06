import { AppShell } from "@/components/layout/app-shell";
import { CartModule } from "@/modules/cart/cart-module";

export default function CartPage() {
  return (
    <AppShell>
      <CartModule />
    </AppShell>
  );
}
