import type { AvatarViewModel } from "@/lib/profile";

function UserSilhouette() {
  return (
    <svg
      aria-hidden="true"
      className="profile-avatar-svg"
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="50" cy="33" fill="currentColor" r="14" />
      <path
        d="M24 78c0-15 11.6-24 26-24s26 9 26 24v4H24Z"
        fill="currentColor"
      />
    </svg>
  );
}

function AgentSilhouette() {
  return (
    <svg
      aria-hidden="true"
      className="profile-avatar-svg"
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        fill="currentColor"
        height="26"
        rx="6"
        width="26"
        x="37"
        y="20"
      />
      <rect
        fill="currentColor"
        height="24"
        rx="10"
        width="44"
        x="28"
        y="58"
      />
    </svg>
  );
}

export function ProfileAvatar({
  avatar,
  className = "",
}: {
  avatar: AvatarViewModel;
  className?: string;
}) {
  const imageSource = avatar.config.imageDataUrl ?? avatar.config.imageUrl;
  const shouldRenderImage =
    avatar.kind === "user" && typeof imageSource === "string";

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
      {shouldRenderImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className="profile-avatar-image"
          draggable={false}
          src={imageSource ?? undefined}
        />
      ) : avatar.kind === "agent" ? (
        <AgentSilhouette />
      ) : (
        <UserSilhouette />
      )}
    </span>
  );
}
