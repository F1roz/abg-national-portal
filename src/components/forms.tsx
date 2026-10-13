"use client";
import { useFormStatus } from "react-dom";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from "react";

const PendingContext = createContext(false);

export function SubmitButton({ children, className = "btn-primary", pendingText, confirm }: { children: React.ReactNode; className?: string; pendingText?: string; confirm?: string }) {
  const { pending: formPending } = useFormStatus();
  const ctxPending = useContext(PendingContext);
  const pending = formPending || ctxPending;
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText ?? "Saving…" : children}
    </button>
  );
}

export type FormState = { ok?: boolean; error?: string; message?: string } | null;

/**
 * Form bound to a server action returning FormState; shows inline success / error messages.
 * Submits via a transition (not the native `action` prop) so React does not clear what the
 * user typed when the server rejects the input. Fields are reset only on success, if asked.
 */
export function ActionForm({
  action, children, className = "space-y-3", resetOnSuccess = false,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <PendingContext.Provider value={isPending}>
      <form
        ref={ref}
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
          startTransition(() => formAction(data));
        }}
      >
        {state?.error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div> : null}
        {state?.ok && state.message ? <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{state.message}</div> : null}
        {children}
      </form>
    </PendingContext.Provider>
  );
}
