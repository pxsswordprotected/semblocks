import { Dashboard } from "@/features/dashboard/Dashboard";
import { DashboardViewportGate } from "@/features/dashboard/DashboardViewportGate";
import { isAdmin, isAdminConfigured } from "@/lib/admin-auth";

type DevPageProps = {
  searchParams?: Promise<{ error?: string | string[] }>;
};

export default async function DevPage({ searchParams }: DevPageProps) {
  const admin = await isAdmin();
  if (admin) {
    return (
      <DashboardViewportGate>
        <Dashboard ownerMode />
      </DashboardViewportGate>
    );
  }

  const params = await searchParams;
  const error = Array.isArray(params?.error) ? params?.error[0] : params?.error;
  const configured = isAdminConfigured();

  return (
    <main className="flex min-h-screen items-center justify-center p-page">
      <section className="w-full max-w-sm rounded-base border border-stroke bg-dashboard bg-[image:var(--gradient-panel)] p-6 shadow-[var(--shadow-base),var(--shadow-inner-base)]">
        <h1 className="text-xl leading-6 font-bold text-neutral-800">
          Owner mode
        </h1>
        <p className="mt-2 text-sm leading-5 text-black/50">
          Enter the admin password to open the private dashboard.
        </p>

        {!configured ? (
          <p className="mt-4 rounded-base border border-error/30 bg-white/40 p-3 text-sm leading-5 text-error">
            Admin auth is not configured. Set ARESEARCH_ADMIN_PASSWORD and
            ADMIN_COOKIE_SECRET in the server environment.
          </p>
        ) : null}

        {configured && error ? (
          <p className="mt-4 rounded-base border border-error/30 bg-white/40 p-3 text-sm leading-5 text-error">
            {errorMessage(error)}
          </p>
        ) : null}

        <form action="/api/admin/login" method="post" className="mt-6 space-y-4">
          <label className="block text-sm font-bold text-neutral-800">
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={!configured}
              className="mt-2 w-full rounded-base border border-stroke bg-white/50 px-3 py-2 text-base font-normal text-neutral-800 outline-none focus:border-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <button
            type="submit"
            disabled={!configured}
            className="w-full rounded-base bg-neutral-900 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Log in
          </button>
        </form>
      </section>
    </main>
  );
}

function errorMessage(error: string): string {
  if (error === "invalid") return "Invalid password.";
  if (error === "missing") return "Password is required.";
  if (error === "config") return "Admin auth is not configured.";
  return "Login failed.";
}
