import { prisma } from "@/lib/prisma";
import { normalizeProfileConfig, type AvatarViewModel } from "@/lib/profile";

export type VideoCallUser = {
  avatar: AvatarViewModel;
  displayName: string;
  id: string;
  status: "INVITED" | "JOINED" | "LEFT";
  username: string;
};

export type VideoCallSummary = {
  createdByUserId: string | null;
  dailyRoomUrl: string;
  endedAt: string | null;
  id: string;
  invited: VideoCallUser[];
  joined: VideoCallUser[];
  name: string;
  startedAt: string;
  status: "ACTIVE" | "ENDED";
  transcriptAvailable: boolean;
  transcriptStatus: string;
};

export type VideoCallInviteCandidate = {
  avatar: AvatarViewModel;
  displayName: string;
  id: string;
  isCurrentUser: boolean;
  username: string;
};

function mapCallUser(participant: {
  status: "INVITED" | "JOINED" | "LEFT";
  user: {
    displayName: string;
    id: string;
    profileConfigJson: unknown;
    username: string;
  };
}) {
  return {
    avatar: {
      kind: "user" as const,
      config: normalizeProfileConfig(
        participant.user.profileConfigJson,
        participant.user.username,
        "user",
      ),
    },
    displayName: participant.user.displayName,
    id: participant.user.id,
    status: participant.status,
    username: participant.user.username,
  };
}

function mapVideoCall(call: {
  createdByUserId: string | null;
  dailyRoomUrl: string;
  endedAt: Date | null;
  id: string;
  name: string;
  participants: Array<{
    status: "INVITED" | "JOINED" | "LEFT";
    user: {
      displayName: string;
      id: string;
      profileConfigJson: unknown;
      username: string;
    };
  }>;
  startedAt: Date;
  status: "ACTIVE" | "ENDED";
  transcriptStatus: string;
  transcriptText: string | null;
}): VideoCallSummary {
  const participants = call.participants.map(mapCallUser);
  const joined = participants.filter((participant) => participant.status === "JOINED");
  const invited = participants.filter((participant) => participant.status !== "JOINED");

  return {
    createdByUserId: call.createdByUserId,
    dailyRoomUrl: call.dailyRoomUrl,
    endedAt: call.endedAt?.toISOString() ?? null,
    id: call.id,
    invited,
    joined,
    name: call.name,
    startedAt: call.startedAt.toISOString(),
    status: call.status,
    transcriptAvailable: Boolean(call.transcriptText?.trim()),
    transcriptStatus: call.transcriptStatus,
  };
}

async function dailyCreateRoom(name: string) {
  const apiKey = process.env.DAILY_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Daily API key is not configured.");
  }

  const response = await fetch("https://api.daily.co/v1/rooms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      privacy: "public",
      properties: {
        enable_chat: false,
        enable_people_ui: true,
        enable_prejoin_ui: true,
        enable_recording: false,
        enable_transcription: "cloud",
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    info?: string;
    name?: string;
    url?: string;
  } | null;

  if (!response.ok || !payload?.url || !payload.name) {
    throw new Error(payload?.info ?? payload?.error ?? "Daily room could not be created.");
  }

  return {
    dailyRoomName: payload.name,
    dailyRoomUrl: payload.url,
  };
}

export async function listVideoCallState(userId: string) {
  const [activeCalls, history] = await Promise.all([
    prisma.videoCall.findMany({
      where: {
        status: "ACTIVE",
        participants: {
          some: {
            userId,
          },
        },
      },
      include: {
        participants: {
          include: {
            user: true,
          },
          orderBy: {
            invitedAt: "asc",
          },
        },
      },
      orderBy: {
        startedAt: "desc",
      },
    }),
    prisma.videoCall.findMany({
      where: {
        status: "ENDED",
        participants: {
          some: {
            userId,
          },
        },
      },
      include: {
        participants: {
          include: {
            user: true,
          },
          orderBy: {
            invitedAt: "asc",
          },
        },
      },
      orderBy: {
        startedAt: "desc",
      },
      take: 50,
    }),
  ]);

  return {
    activeCalls: activeCalls.map(mapVideoCall),
    history: history.map(mapVideoCall),
  };
}

export async function listVideoCallInviteCandidates(
  currentUserId: string,
): Promise<VideoCallInviteCandidate[]> {
  const currentUser = await prisma.user.findUnique({
    where: {
      id: currentUserId,
    },
    select: {
      teamId: true,
    },
  });

  if (!currentUser?.teamId) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      teamId: currentUser.teamId,
    },
    orderBy: [
      {
        displayName: "asc",
      },
      {
        username: "asc",
      },
    ],
  });

  return users.map((user) => ({
    avatar: {
      kind: "user" as const,
      config: normalizeProfileConfig(user.profileConfigJson, user.username, "user"),
    },
    displayName: user.displayName,
    id: user.id,
    isCurrentUser: user.id === currentUserId,
    username: user.username,
  }));
}

export async function hasJoinedActiveVideoCall(userId: string, exceptCallId?: string) {
  const activeCall = await prisma.videoCallParticipant.findFirst({
    where: {
      userId,
      status: "JOINED",
      call: {
        status: "ACTIVE",
        id: exceptCallId
          ? {
              not: exceptCallId,
            }
          : undefined,
      },
    },
    select: {
      callId: true,
    },
  });

  return Boolean(activeCall);
}

export async function createVideoCall(args: {
  createdByUserId: string;
  invitedUserIds: string[];
  name: string;
}) {
  const callName = args.name.trim();

  if (!callName) {
    throw new Error("Call name is required.");
  }

  const uniqueUserIds = Array.from(
    new Set([args.createdByUserId, ...args.invitedUserIds]),
  );
  const dailyRoomSlug = `cyworld-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const dailyRoom = await dailyCreateRoom(dailyRoomSlug);

  const call = await prisma.videoCall.create({
    data: {
      createdByUserId: args.createdByUserId,
      dailyRoomName: dailyRoom.dailyRoomName,
      dailyRoomUrl: dailyRoom.dailyRoomUrl,
      name: callName,
      transcriptStatus: "PENDING",
      participants: {
        create: uniqueUserIds.map((userId) => ({
          userId,
          status: userId === args.createdByUserId ? "JOINED" : "INVITED",
          joinedAt: userId === args.createdByUserId ? new Date() : null,
        })),
      },
    },
    include: {
      participants: {
        include: {
          user: true,
        },
      },
    },
  });

  return mapVideoCall(call);
}

export async function joinVideoCall(callId: string, userId: string) {
  await prisma.videoCallParticipant.update({
    where: {
      callId_userId: {
        callId,
        userId,
      },
    },
    data: {
      status: "JOINED",
      joinedAt: new Date(),
      leftAt: null,
    },
  });
}

export async function leaveVideoCall(callId: string, userId: string) {
  await prisma.videoCallParticipant.update({
    where: {
      callId_userId: {
        callId,
        userId,
      },
    },
    data: {
      status: "LEFT",
      leftAt: new Date(),
    },
  });

  const remaining = await prisma.videoCallParticipant.count({
    where: {
      callId,
      status: "JOINED",
    },
  });

  if (remaining === 0) {
    const call = await prisma.videoCall.findUnique({
      where: {
        id: callId,
      },
      include: {
        participants: {
          include: {
            user: true,
          },
        },
      },
    });

    const transcriptLines = call
      ? [
          `CyWorld Video Call Transcript`,
          ``,
          `Call: ${call.name}`,
          `Started: ${call.startedAt.toISOString()}`,
          `Ended: ${new Date().toISOString()}`,
          `Participants: ${call.participants
            .map((participant) => participant.user.displayName)
            .join(", ")}`,
          ``,
          `Automatic transcription is pending Daily transcript webhook integration.`,
        ]
      : [];

    await prisma.videoCall.update({
      where: {
        id: callId,
      },
      data: {
        endedAt: new Date(),
        status: "ENDED",
        transcriptStatus: "PLACEHOLDER",
        transcriptText: transcriptLines.join("\n"),
      },
    });
  }
}

export async function getVideoCallTranscript(callId: string, userId: string) {
  const call = await prisma.videoCall.findFirst({
    where: {
      id: callId,
      participants: {
        some: {
          userId,
        },
      },
    },
    include: {
      participants: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!call) {
    return null;
  }

  const fallback = [
    `CyWorld Video Call Transcript`,
    ``,
    `Call: ${call.name}`,
    `Started: ${call.startedAt.toISOString()}`,
    call.endedAt ? `Ended: ${call.endedAt.toISOString()}` : null,
    `Participants: ${call.participants
      .map((participant) => participant.user.displayName)
      .join(", ")}`,
    ``,
    `Transcript is not available yet.`,
  ].filter(Boolean);

  return {
    filename: `${call.name.replace(/[^\w .@()-]+/g, "_") || "video-call"}-transcript.txt`,
    text: call.transcriptText?.trim() || fallback.join("\n"),
  };
}

export async function deleteVideoCallHistory(callId: string, userId: string) {
  await prisma.videoCallParticipant.deleteMany({
    where: {
      callId,
      userId,
    },
  });
}
