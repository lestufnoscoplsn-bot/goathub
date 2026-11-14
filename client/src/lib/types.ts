export type Status = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface User {
  id: number; username: string; avatar: string | null; accentColor: string; bio: string; customStatus: string; status: Status;
}
export interface Me extends User { statusPref: Exclude<Status, 'offline'>; email: string; twoFactor: boolean; isAdmin: boolean }

export interface Role { id: number; name: string; color: string; permissions: number; position: number; isDefault: boolean; hoist: boolean }
export interface Member { user: User; nickname: string | null; roles: number[]; joinedAt: string; mutedUntil: string | null; voiceMuted: boolean }
export interface Category { id: number; name: string; position: number }
export interface Channel { id: number; type: 'text' | 'voice'; name: string; topic: string; position: number; slowmode: number; userLimit: number; categoryId: number | null }
export interface Server { id: number; name: string; icon: string | null; ownerId: number; roles: Role[]; categories: Category[]; channels: Channel[]; members: Member[] }

export interface Dm { id: number; type: 'dm' | 'group'; name: string; ownerId: number | null; recipients: User[]; lastMessageId: number }

export interface Attachment { id: string; url: string; name: string; size: number; kind: 'image' | 'video' | 'audio' | 'file' }
export interface Message {
  id: number; channelId: number; serverId: number | null;
  author: { id: number; username: string; avatar: string | null } | null;
  content: string; kind: 'default' | 'call' | 'system'; attachments: Attachment[]; mentions: number[]; mentionEveryone: boolean;
  replyTo: { id: number; content: string; hasAttachment: boolean; author: { id: number; username: string; avatar: string | null } | null } | null;
  pinned: boolean; reactions: { emoji: string; users: number[] }[]; createdAt: string; editedAt: string | null; nonce?: string;
  pending?: boolean;
}

export interface VoiceUser { userId: number; muted: boolean; deafened: boolean; serverMuted: boolean; video: boolean; screen: boolean; joinedAt: number }
export interface Call { channelId: number; startedBy: number | null; ringing: number[]; ended?: boolean }
export type Relation = 'friend' | 'incoming' | 'outgoing' | 'blocked';
