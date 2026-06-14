export type AppNavItem = {
  href: string;
  icon: "calendar" | "dm" | "files" | "setting" | "team" | "video-call";
  title: string;
  description: string;
};

export const primaryNavItems: AppNavItem[] = [
  {
    href: "/chat",
    icon: "dm",
    title: "DM",
    description: "Talk to your personal agent and assign work.",
  },
  {
    href: "/team",
    icon: "team",
    title: "Team Chat",
    description: "Coordinate with teammates without introducing a team agent.",
  },
  {
    href: "/video-call",
    icon: "video-call",
    title: "Video Call",
    description: "Start or join live calls with human participants.",
  },
  {
    href: "/files",
    icon: "files",
    title: "Drive",
    description: "Upload, download, and share working materials.",
  },
  {
    href: "/calendar",
    icon: "calendar",
    title: "Calendar",
    description: "Plan events with invitation-based access.",
  },
];

export const secondaryNavItems: AppNavItem[] = [
  {
    href: "/agent",
    icon: "setting",
    title: "Setting",
    description: "Tune tone, habits, and future persona settings.",
  },
];
