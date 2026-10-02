"use client";

import { useState } from "react";
import { NotificationHistory, Role } from "@/lib/types";
import Sidebar from "./Sidebar";
import Header from "./Header";

interface ActionNeeded {
  count: number;
  message: string;
  href: string;
}

export default function AppShell({
  role,
  name,
  token,
  actionNeeded,
  notificationHistory,
  children,
}: {
  role: Role;
  name: string;
  token?: string;
  actionNeeded?: ActionNeeded;
  notificationHistory?: NotificationHistory;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex">
      <Sidebar role={role} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex-1 min-w-0">
        <Header
          name={name}
          role={role}
          token={token}
          actionNeeded={actionNeeded}
          notificationHistory={notificationHistory}
          onMenuClick={() => setMobileOpen(true)}
        />
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
