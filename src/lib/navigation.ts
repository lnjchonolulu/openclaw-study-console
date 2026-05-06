export type AppNavItem = {
  href: string;
  icon: "dm" | "team" | "files" | "setting";
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
    href: "/files",
    icon: "files",
    title: "Files",
    description: "Upload, download, and share working materials.",
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
