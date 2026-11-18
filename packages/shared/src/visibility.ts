import type { CampaignInfo, ChatMessage, Member, Token, Viewer } from './types';

export const effectiveMapId = (member: Member, campaign: CampaignInfo): string | null =>
  member.currentMapId ?? campaign.defaultMapId;

export const canSeeMap = (v: Viewer, mapId: string): boolean => v.role === 'gm' || v.mapId === mapId;

export const canSeeToken = (v: Viewer, t: Token): boolean =>
  canSeeMap(v, t.mapId) && (v.role === 'gm' || t.layer === 'tokens');

export const canSeeMessage = (v: Viewer, m: ChatMessage): boolean =>
  m.recipients === null || m.recipients.includes(v.userId);
