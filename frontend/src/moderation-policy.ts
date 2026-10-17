export type PolicyLevel = 'RELAXED' | 'BALANCED' | 'STRICT';
export type PolicySnapshot = {
  level: PolicyLevel;
  autoHide: boolean;
  autoMute: boolean;
  muteSeconds: number;
  reviewThreshold: number;
  blockThreshold: number;
  blockedWords: string[];
  blockedTopics: string[];
  allowLinks: boolean;
};

/** A validated, independent copy of a server moderation policy, never a shared mutable template. */
export class ModerationPolicyDraft {
  private constructor(private readonly data: PolicySnapshot) {}

  static fromServer(value: unknown): ModerationPolicyDraft {
    const fail = (): never => {throw new Error('Invalid moderation policy');};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    const row = value as Record<string, unknown>;
    if (!['RELAXED', 'BALANCED', 'STRICT'].includes(String(row.level))) return fail();
    if (typeof row.level !== 'string') return fail();
    for (const key of ['autoHide', 'autoMute', 'allowLinks']) if (typeof row[key] !== 'boolean') return fail();
    if (typeof row.muteSeconds !== 'number' || !Number.isInteger(row.muteSeconds) || row.muteSeconds < 30 || row.muteSeconds > 86400) return fail();
    const review = row.reviewThreshold, block = row.blockThreshold;
    if (typeof review !== 'number' || typeof block !== 'number' || !Number.isFinite(review) || !Number.isFinite(block) || review < 0 || block > 1 || review > block) return fail();
    const list = (key: string, count: number, length: number): string[] => {
      const values = row[key];
      if (!Array.isArray(values) || values.length > count || values.some(item => typeof item !== 'string' || !item.trim() || item.length > length)) return fail();
      return [...values] as string[];
    };
    return new ModerationPolicyDraft({level: row.level as PolicyLevel, autoHide: row.autoHide as boolean,
      autoMute: row.autoMute as boolean, muteSeconds: row.muteSeconds,
      reviewThreshold: review, blockThreshold: block, allowLinks: row.allowLinks as boolean,
      blockedWords: list('blockedWords', 50, 80), blockedTopics: list('blockedTopics', 30, 120)});
  }

  copy(): ModerationPolicyDraft {
    return ModerationPolicyDraft.fromServer(this.snapshot());
  }

  snapshot(): PolicySnapshot {
    return {...this.data, blockedWords: [...this.data.blockedWords], blockedTopics: [...this.data.blockedTopics]};
  }
}
