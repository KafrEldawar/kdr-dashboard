"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { BrandLogo } from "@/components/layout/brand-logo";

type FullScreenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
};

export function FullScreenDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: FullScreenDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-overlay-in" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col bg-background focus:outline-none">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-5 py-3.5 sm:px-8">
            <div className="flex items-center gap-3">
              <BrandLogo size={36} />
              <div className="border-s border-border ps-3">
                <Dialog.Title className="text-lg font-bold tracking-tight">{title}</Dialog.Title>
                {description ? (
                  <Dialog.Description className="text-sm text-muted-foreground">
                    {description}
                  </Dialog.Description>
                ) : null}
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="إغلاق"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
