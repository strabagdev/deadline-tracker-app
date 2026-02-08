import AppHeader from "@/components/AppHeader";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <AppHeader />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        {children}
      </main>
    </div>
  );
}
