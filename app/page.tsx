import { Dashboard } from "@/features/dashboard/Dashboard";
import { DashboardViewportGate } from "@/features/dashboard/DashboardViewportGate";

export default function Home() {
  return (
    <DashboardViewportGate>
      <Dashboard />
    </DashboardViewportGate>
  );
}
