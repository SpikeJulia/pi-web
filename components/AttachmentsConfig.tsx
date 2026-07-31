"use client";

import { useCallback, useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { responseError } from "@/lib/response-error";

interface CleanupResponse {
  ok?: boolean;
  scope?: "session" | "project";
  path?: string;
  deletedCount?: number;
  sessionId?: string;
  error?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "working"; scope: "session" | "project" }
  | { kind: "success"; scope: "session" | "project"; deletedCount: number; path: string }
  | { kind: "error"; scope: "session" | "project"; message: string };

type ProjectConfirmStep = "idle" | "confirming-path" | "ready-to-run";

function shortenPath(p: string): string {
  return p
    .replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/, "~")
    .replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function joinPath(cwd: string, sessionId: string | null): string {
  return sessionId ? `${cwd}/.pi-uploads/${sessionId}` : `${cwd}/.pi-uploads`;
}

function displayCleanupPath(cwd: string, sessionId: string | null): string {
  const shortened = shortenPath(cwd);
  return sessionId ? `${shortened}/.pi-uploads/${sessionId}` : `${shortened}/.pi-uploads`;
}

interface CleanupActionCardProps {
  title: string;
  description: string;
  flow: "single" | "double";
  affectedPath: string;
  buttonLabel: string;
  working: boolean;
  disabled: boolean;
  disabledReason?: string | null;
  errorMessage?: string | null;
  onConfirm: () => void;
}

function CleanupActionCard({
  title,
  description,
  flow,
  affectedPath,
  buttonLabel,
  working,
  disabled,
  disabledReason,
  errorMessage,
  onConfirm,
}: CleanupActionCardProps) {
  const [projectStep, setProjectStep] = useState<ProjectConfirmStep>("idle");

  // Reset the double-confirmation ladder when the parent disables the action
  // (e.g. when scope changes after a fork, or the user closes the modal).
  useEffect(() => {
    if (disabled && projectStep !== "idle") setProjectStep("idle");
  }, [disabled, projectStep]);

  const showProjectConfirm = flow === "double" && projectStep === "confirming-path";

  const handleClick = () => {
    if (disabled) return;
    if (flow === "single") {
      onConfirm();
      return;
    }
    if (projectStep === "idle") {
      setProjectStep("confirming-path");
      return;
    }
    if (projectStep === "confirming-path") {
      setProjectStep("ready-to-run");
      return;
    }
    onConfirm();
  };

  const buttonText = (() => {
    if (working) return "Working…";
    if (flow === "single") return buttonLabel;
    if (projectStep === "idle") return "Clear project attachments";
    if (projectStep === "confirming-path") return "I understand — continue";
    return "Delete everything now";
  })();

  const buttonActionStyle: "primary" | "danger" = (() => {
    if (flow === "single") return "primary";
    if (projectStep === "ready-to-run") return "danger";
    return "primary";
  })();

  const buttonColor = (() => {
    if (disabled) return "var(--text-dim)";
    if (buttonActionStyle === "danger") return "#ffffff";
    if (working) return "var(--accent)";
    return "var(--accent)";
  })();
  const buttonBackground = (() => {
    if (disabled) return "var(--bg-panel)";
    if (buttonActionStyle === "danger") return "#dc2626";
    if (working) return "var(--accent)";
    return "var(--accent)";
  })();
  const buttonBorder = (() => {
    if (disabled) return "var(--border)";
    if (buttonActionStyle === "danger") return "#dc2626";
    return "var(--accent)";
  })();

  return (
    <div
      style={{
        padding: "16px 18px",
        border: "1px solid var(--border)",
        borderRadius: 9,
        background: "var(--bg-panel)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {title}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>
          {description}
        </span>
      </div>

      <div
        style={{
          padding: "8px 10px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
        title={affectedPath}
      >
        {affectedPath}
      </div>

      {showProjectConfirm && (
        <div
          role="alert"
          style={{
            padding: "8px 10px",
            border: "1px solid rgba(220, 38, 38, 0.35)",
            borderRadius: 6,
            background: "rgba(220, 38, 38, 0.08)",
            color: "#dc2626",
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          This will delete <strong>every</strong> attachment under{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>{affectedPath}</code>{" "}
          for every session in this project. History messages are not rewritten
          — references will simply resolve to nothing.
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: "#f87171",
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}
        >
          {errorMessage}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {disabled && disabledReason ? (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {disabledReason}
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled || working}
          style={{
            padding: "6px 14px",
            background: buttonBackground,
            border: `1px solid ${buttonBorder}`,
            borderRadius: 6,
            color: buttonColor,
            cursor: disabled || working ? "not-allowed" : "pointer",
            opacity: disabled ? 0.45 : working ? 0.7 : 1,
            fontSize: 12,
            fontWeight: buttonActionStyle === "danger" ? 600 : 500,
            whiteSpace: "nowrap",
          }}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}

export function AttachmentsConfig({
  cwd,
  sessionId,
  onClose,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // When the cleanup completes, the parent still receives the same `cwd` and
  // `sessionId` props. Clearing the status automatically once it has been
  // visible for a few seconds keeps the modal in a usable state.
  useEffect(() => {
    if (status.kind !== "success") return;
    const timer = setTimeout(() => {
      setStatus({ kind: "idle" });
    }, 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const cleanup = useCallback(
    async (scope: "session" | "project") => {
      if (scope === "session" && !sessionId) return;
      setStatus({ kind: "working", scope });
      try {
        const response = await fetch("/api/attachments/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd,
            scope,
            ...(scope === "session" ? { sessionId } : {}),
          }),
        });
        const data = (await response.json().catch(() => null)) as CleanupResponse | null;
        if (!response.ok || !data?.ok) {
          const message = responseError(data) ?? `HTTP ${response.status}`;
          setStatus({ kind: "error", scope, message });
          return;
        }
        setStatus({
          kind: "success",
          scope,
          deletedCount: data.deletedCount ?? 0,
          path: data.path ?? joinPath(cwd, scope === "session" ? sessionId : null),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus({ kind: "error", scope, message });
      }
    },
    [cwd, sessionId],
  );

  const sessionDisplayPath = sessionId ? displayCleanupPath(cwd, sessionId) : null;
  const projectDisplayPath = displayCleanupPath(cwd, null);

  const sessionActive = status.kind === "working" && status.scope === "session";
  const projectActive = status.kind === "working" && status.scope === "project";

  const sessionError = status.kind === "error" && status.scope === "session" ? status.message : null;
  const projectError = status.kind === "error" && status.scope === "project" ? status.message : null;

  const sessionSuccess =
    status.kind === "success" && status.scope === "session"
      ? status.deletedCount === 0
        ? "Session directory was already empty."
        : `Removed ${status.deletedCount} ${status.deletedCount === 1 ? "entry" : "entries"} from ${sessionDisplayPath}.`
      : null;
  const projectSuccess =
    status.kind === "success" && status.scope === "project"
      ? status.deletedCount === 0
        ? "Project upload directory was already empty."
        : `Removed ${status.deletedCount} ${status.deletedCount === 1 ? "entry" : "entries"} from ${projectDisplayPath}.`
      : null;

  return (
    <div
      data-attachments-settings-modal
      role="dialog"
      aria-modal="true"
      aria-labelledby="attachments-settings-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 620,
          maxWidth: "calc(100vw - 16px)",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              minWidth: 0,
            }}
          >
            <span
              id="attachments-settings-title"
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--text)",
                flexShrink: 0,
              }}
            >
              Attachments
            </span>
            <code
              title={`${cwd}/.pi-uploads`}
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortenPath(cwd)}/.pi-uploads
            </code>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close attachments settings"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: isMobile ? 16 : 20,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}
          >
            Attachments live under{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>{projectDisplayPath}</code>{" "}
            in a per-session subdirectory. The cleanup actions below delete
            files and sidecars only — history messages are never rewritten, so
            any chat reference to a removed attachment simply resolves to
            nothing.
          </p>

          {(sessionSuccess || projectSuccess) && (
            <div
              role="status"
              data-attachments-cleanup-status
              style={{
                padding: "8px 10px",
                border: "1px solid rgba(22, 163, 74, 0.3)",
                borderRadius: 6,
                background: "rgba(22, 163, 74, 0.08)",
                color: "#16a34a",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {sessionSuccess ?? projectSuccess}
            </div>
          )}

          <CleanupActionCard
            title="Clear current session attachments"
            description={
              sessionId
                ? "Deletes the per-session directory. Requires one confirmation."
                : "No active session. Start a session and send a message before clearing session attachments."
            }
            flow="single"
            affectedPath={sessionDisplayPath ?? `${projectDisplayPath}/<session>`}
            buttonLabel="Clear session attachments"
            working={sessionActive}
            disabled={!sessionId}
            disabledReason={sessionId ? null : "No active session"}
            errorMessage={sessionError}
            onConfirm={() => void cleanup("session")}
          />

          <CleanupActionCard
            title="Clear project attachments"
            description="Deletes every per-session directory under the project's .pi-uploads folder. Requires double confirmation and shows the affected directory."
            flow="double"
            affectedPath={projectDisplayPath}
            buttonLabel="Clear project attachments"
            working={projectActive}
            disabled={false}
            errorMessage={projectError}
            onConfirm={() => void cleanup("project")}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            data-attachments-settings-close
            style={{
              padding: "6px 14px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
