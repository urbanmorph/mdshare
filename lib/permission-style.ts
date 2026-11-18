import type { Permission } from "./tokens";

const BADGE: Record<Permission, string> = {
  admin: "bg-purple-900/50 text-purple-300",
  edit: "bg-blue-900/50 text-blue-300",
  comment: "bg-amber-900/50 text-amber-300",
  view: "bg-neutral-800 text-neutral-400",
};

/** Tailwind classes for a small permission badge (recent documents, link list). */
export function permissionBadgeClass(permission: Permission | string): string {
  return BADGE[permission as Permission] ?? BADGE.view;
}
