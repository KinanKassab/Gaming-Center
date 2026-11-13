import { HardRedirect } from "@/app/_components/hard-redirect";
import { ADMIN_NAV_HREFS } from "@/ui/admin-nav";

export default function GamingDeviceTypesPage() {
  return <HardRedirect href={ADMIN_NAV_HREFS.devices} />;
}
