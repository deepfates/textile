import type {
  Loom,
  TurnId,
} from "@deepfates/lync";
import type {
  TextStoryLoomMeta,
  TextStoryTurnMeta,
  TextStoryTurnPayload,
} from "@deepfates/lync/profiles/text-story";

export type StoryTurnPayload = TextStoryTurnPayload;
export type StoryLoomMeta = TextStoryLoomMeta;
export type StoryEntryMeta = { title: string };

export interface StoryDraft {
  text: string;
  continuations?: StoryDraft[];
}

export type StoryTurnRole =
  | "prose"
  | "revision"
  | "critique"
  | "judge"
  | "summary"
  | "annotation";

/** Fingerprint of the generation that produced a model turn. */
export interface StoryGeneratedBy {
  model?: string;
  temperature?: number;
  lengthMode?: string;
  textSplitting?: boolean;
}

export interface StoryTurnMeta extends TextStoryTurnMeta {
  role: StoryTurnRole;
  /**
   * The person's identity (actor). Stamped into `meta` at every append site so
   * it survives lync's buildFold, which drops `event.body.author` but keeps
   * `meta`. Kept SEPARATE from `via` (the controller).
   */
  author?: string;
  /** The controlling software that wrote the turn, e.g. `"textile-browser"`. */
  via?: string;
  /**
   * Present ONLY on model-generated turns. Its presence is what marks a turn as
   * model origin — a human turn never carries it.
   */
  generatedBy?: StoryGeneratedBy;
  revises?: TurnId;
  references?: TurnId[];
  respondsTo?: TurnId;
}

export type StoryLoom = Loom<StoryTurnPayload, StoryLoomMeta, StoryTurnMeta>;
