import { Toaster as SonnerToaster, toast } from "sonner";

export function Toaster() {
  return <SonnerToaster position="bottom-right" richColors closeButton />;
}

export { toast };
