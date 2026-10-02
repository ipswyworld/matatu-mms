import { redirect } from "next/navigation";

// This is the staff app — county staff (admin, enforcement, director/chief
// officer, viewer) sign in at /login, which is the real front door here.
// The public-facing portal (passengers, crew, Sacco operators) lives in the
// separate public app's own root.
export default function RootPage() {
  redirect("/login");
}
