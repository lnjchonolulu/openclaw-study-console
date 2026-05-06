import type { AvatarViewModel } from "@/lib/profile";

export function ProfileAvatar({
  avatar,
  className = "",
}: {
  avatar: AvatarViewModel;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`profile-avatar ${className}`.trim()}
      style={
        {
          "--avatar-bg": avatar.config.bgColor,
          "--avatar-fg": avatar.config.fgColor,
        } as React.CSSProperties
      }
    >
      <span
        className={`profile-avatar-head ${
          avatar.kind === "agent" ? "profile-avatar-head-agent" : ""
        }`}
      />
      <span
        className={`profile-avatar-body ${
          avatar.kind === "agent" ? "profile-avatar-body-agent" : ""
        }`}
      />
    </span>
  );
}
