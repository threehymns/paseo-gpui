/**
 * One agent tab's conversation panel (#46).
 *
 * Owns everything that must stay alive while its tab is in the background: the
 * live timeline subscription (via `useAgentConversation`), its permission
 * cards, and its own scroll state. The strip keeps every open agent tab's panel
 * mounted and hides the unfocused ones with `display:none`, so switching tabs
 * never tears down a subscription or resets scroll — background turns keep
 * merging and the view jumps straight to where it was.
 *
 * The parent reads the active tab's conversation from `onConversation`, which
 * this panel reports on every render (a ref map, never a state write, so there
 * is no re-render loop).
 */

import React, { useRef } from 'react'
import { useGpuix } from '@gpuix/react'
import type { PaseoClient } from '@getpaseo/client'
import type { DaemonClient } from '@getpaseo/client/internal/daemon-client'
import { Transcript } from '../conversation/transcript'
import { useAgentConversation } from '../conversation/conversation'
import { useAgentPermissions } from '../conversation/permissions'
import { useTranscriptFollow } from '../conversation/follow'
import type { ImageAttachment } from '../composer/attachments'

/** The live conversation surface one agent tab owns. */
export type TabConversation = ReturnType<typeof useAgentConversation>

export interface AgentTabPanelProps {
  client: PaseoClient
  daemon: DaemonClient
  agentId: string
  /** Seed for a draft-tab flip: the first optimistic user turn. */
  seedText: string | null
  seedImages: ImageAttachment[] | null
  onSeedConsumed: () => void
  /** True when this is the focused tab (visible); background tabs hide-not-unmount. */
  hidden: boolean
  /** False while a provider subagent view replaces the parent transcript. */
  showTranscript: boolean
  /** Reports this tab's conversation upward for composer/tracks/meter reads. */
  onConversation: (agentId: string, conversation: TabConversation) => void
  onEditQueued: (queuedId: string) => void
  onOpenFile: (absolutePath: string) => void
  workspaceRoot: string | null
}

export function AgentTabPanel({
  client,
  daemon,
  agentId,
  seedText,
  seedImages,
  onSeedConsumed,
  hidden,
  showTranscript,
  onConversation,
  onEditQueued,
  onOpenFile,
  workspaceRoot,
}: AgentTabPanelProps) {
  const conversation = useAgentConversation(client, agentId, {
    seedText,
    seedImages,
    onSeedConsumed,
  })
  const permissions = useAgentPermissions(client, daemon, agentId)
  const turns = conversation.turns

  onConversation(agentId, conversation)

  const listRef = useRef<{ id: number } | null>(null)

  // Older-history availability for this tab's transcript top edge.
  const olderPages =
    conversation.status === 'ready' && turns.length > 0
      ? conversation.loadingHistory
        ? ('loading' as const)
        : conversation.hasOlder
          ? ('more' as const)
          : ('end' as const)
      : undefined

  const { renderer } = useGpuix()
  const { following, onScroll, requestJump, jumpToTurn } = useTranscriptFollow({
    listRef,
    turnCount: turns.length,
    tailSignature: turns.length > 0 ? JSON.stringify(turns.at(-1)) : undefined,
    agentId: agentId,
    renderer,
    slotOffset: olderPages ? 1 : 0,
  })

  return (
    <div
      style={{
        display: hidden ? 'none' : 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        minHeight: 0,
        width: '100%',
      }}
    >
      {showTranscript && (
        <Transcript
          turns={turns}
          permissions={permissions.cards}
          onRespond={permissions.respond}
          onEditQueued={onEditQueued}
          workspaceRoot={workspaceRoot}
          onOpenFile={onOpenFile}
          listRef={listRef}
          olderPages={olderPages}
          onLoadOlder={conversation.loadHistory}
          detached={!following}
          onScroll={onScroll}
          onJumpToBottom={requestJump}
          onJumpToTurn={jumpToTurn}
        />
      )}
    </div>
  )
}
