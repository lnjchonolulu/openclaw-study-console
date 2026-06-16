import { prisma } from "@/lib/prisma";
import { createCalendarEvent } from "@/lib/calendar";
import { normalizeProfileConfig, type AvatarViewModel } from "@/lib/profile";

export type VideoCallUser = {
  avatar: AvatarViewModel;
  displayName: string;
  id: string;
  status: "INVITED" | "ACCEPTED" | "JOINED" | "LEFT" | "DECLINED";
  username: string;
};

export type VideoCallSummary = {
  createdByUserId: string | null;
  dailyRoomUrl: string | null;
  endedAt: string | null;
  id: string;
  invited: VideoCallUser[];
  joined: VideoCallUser[];
  name: string;
  scheduledFor: string | null;
  startedAt: string;
  status: "SCHEDULED" | "ACTIVE" | "ENDED";
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
  status: "INVITED" | "ACCEPTED" | "JOINED" | "LEFT" | "DECLINED";
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
  dailyRoomUrl: string | null;
  endedAt: Date | null;
  id: string;
  name: string;
  participants: Array<{
    status: "INVITED" | "ACCEPTED" | "JOINED" | "LEFT" | "DECLINED";
    user: {
      displayName: string;
      id: string;
      profileConfigJson: unknown;
      username: string;
    };
  }>;
  scheduledFor: Date | null;
  startedAt: Date;
  status: "SCHEDULED" | "ACTIVE" | "ENDED";
  transcriptStatus: string;
  transcriptText: string | null;
}): VideoCallSummary {
  const participants = call.participants.map(mapCallUser);
  const joined = participants.filter((participant) => participant.status === "JOINED");
  const invited = participants.filter(
    (participant) =>
      participant.status !== "JOINED" && participant.status !== "DECLINED",
  );

  return {
    createdByUserId: call.createdByUserId,
    dailyRoomUrl: call.dailyRoomUrl,
    endedAt: call.endedAt?.toISOString() ?? null,
    id: call.id,
    invited,
    joined,
    name: call.name,
    scheduledFor: call.scheduledFor?.toISOString() ?? null,
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
        enable_transcription_storage: true,
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

async function dailyStartRoomTranscription(roomName: string) {
  const apiKey = process.env.DAILY_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Daily API key is not configured.");
  }

  const response = await fetch(
    `https://api.daily.co/v1/rooms/${encodeURIComponent(roomName)}/transcription/start`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );

  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    info?: string;
  } | null;
  const message =
    payload?.info ??
    payload?.error ??
    `Daily transcription could not be started (${response.status}).`;

  if (!response.ok && !/already|started|running/i.test(message)) {
    throw new Error(message);
  }

  return payload;
}

export async function listVideoCallState(userId: string) {
  const now = new Date();
  const [activeCalls, scheduledCalls, history] = await Promise.all([
    prisma.videoCall.findMany({
      where: {
        status: "ACTIVE",
        participants: {
          some: {
            userId,
            status: {
              notIn: ["LEFT", "DECLINED"],
            },
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
        scheduledFor: {
          gte: now,
        },
        status: "SCHEDULED",
        participants: {
          some: {
            userId,
            status: {
              in: ["ACCEPTED", "JOINED"],
            },
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
        scheduledFor: "asc",
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
    scheduledCalls: scheduledCalls.map(mapVideoCall),
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

export async function scheduleVideoCall(args: {
  createdByUserId: string;
  endAt: Date;
  invitedUserIds: string[];
  name: string;
  startAt: Date;
}) {
  const callName = args.name.trim();

  if (!callName) {
    throw new Error("Call name is required.");
  }

  if (args.endAt.getTime() <= args.startAt.getTime()) {
    throw new Error("Call end must be after the start.");
  }

  const event = await createCalendarEvent({
    createdByUserId: args.createdByUserId,
    description: "CyWorld Video Call",
    endAt: args.endAt,
    invitedUserIds: args.invitedUserIds,
    startAt: args.startAt,
    title: callName,
  });
  const uniqueUserIds = Array.from(
    new Set([args.createdByUserId, ...args.invitedUserIds]),
  );

  const call = await prisma.videoCall.create({
    data: {
      calendarEventId: event.id,
      createdByUserId: args.createdByUserId,
      name: callName,
      scheduledFor: args.startAt,
      startedAt: args.startAt,
      status: "SCHEDULED",
      transcriptStatus: "PENDING",
      participants: {
        create: uniqueUserIds.map((userId) => ({
          userId,
          status: userId === args.createdByUserId ? "ACCEPTED" : "INVITED",
          joinedAt: null,
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

export async function startScheduledVideoCall(callId: string, userId: string) {
  if (await hasJoinedActiveVideoCall(userId, callId)) {
    throw new Error("Leave your current call before starting another one.");
  }

  const call = await prisma.videoCall.findFirst({
    where: {
      id: callId,
      status: "SCHEDULED",
      participants: {
        some: {
          status: {
            in: ["ACCEPTED", "JOINED"],
          },
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
    throw new Error("This scheduled call is not available to your account.");
  }

  const dailyRoom =
    call.dailyRoomName && call.dailyRoomUrl
      ? {
          dailyRoomName: call.dailyRoomName,
          dailyRoomUrl: call.dailyRoomUrl,
        }
      : await dailyCreateRoom(
          `cyworld-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );

  const startedCall = await prisma.videoCall.update({
    where: {
      id: call.id,
    },
    data: {
      dailyRoomName: dailyRoom.dailyRoomName,
      dailyRoomUrl: dailyRoom.dailyRoomUrl,
      endedAt: null,
      startedAt: new Date(),
      status: "ACTIVE",
      participants: {
        update: {
          where: {
            callId_userId: {
              callId: call.id,
              userId,
            },
          },
          data: {
            joinedAt: new Date(),
            leftAt: null,
            status: "JOINED",
          },
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

  return mapVideoCall(startedCall);
}

export async function joinVideoCall(callId: string, userId: string) {
  const participant = await prisma.videoCallParticipant.findFirst({
    where: {
      callId,
      status: {
        not: "DECLINED",
      },
      userId,
      call: {
        status: "ACTIVE",
      },
    },
    include: {
      call: {
        select: {
          dailyRoomUrl: true,
        },
      },
    },
  });

  if (!participant?.call.dailyRoomUrl) {
    throw new Error("This call is not active.");
  }

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

  if (!call) {
    throw new Error("This call is not active.");
  }

  return mapVideoCall(call);
}

export async function startVideoCallTranscription(callId: string, userId: string) {
  const call = await prisma.videoCall.findFirst({
    where: {
      id: callId,
      status: "ACTIVE",
      participants: {
        some: {
          status: "JOINED",
          userId,
        },
      },
    },
    select: {
      dailyRoomName: true,
      transcriptStatus: true,
      transcriptText: true,
    },
  });

  if (!call) {
    return {
      ok: false,
      reason: "call_not_joined_or_inactive",
    };
  }

  if (!call.dailyRoomName) {
    return {
      ok: false,
      reason: "daily_room_not_ready",
    };
  }

  if (call.transcriptText?.trim()) {
    return {
      ok: true,
      reason: "transcript_already_ready",
    };
  }

  await dailyStartRoomTranscription(call.dailyRoomName);

  await prisma.videoCall.update({
    where: {
      id: callId,
    },
    data: {
      transcriptStatus:
        call.transcriptStatus === "READY" || call.transcriptStatus === "EMPTY"
          ? call.transcriptStatus
          : "STARTED",
    },
  });

  return {
    ok: true,
    reason: "transcription_started",
  };
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
      select: {
        transcriptStatus: true,
        transcriptText: true,
      },
    });

    const now = new Date();

    await prisma.videoCall.update({
      where: {
        id: callId,
      },
      data: {
        endedAt: now,
        status: "ENDED",
        transcriptStatus: call?.transcriptText?.trim()
          ? call.transcriptStatus
          : "PENDING",
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

export async function removeVideoCallFromUserList(callId: string, userId: string) {
  await prisma.videoCallParticipant.deleteMany({
    where: {
      callId,
      userId,
    },
  });
}
