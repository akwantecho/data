/** Shared loading/error/empty presentations (plan §22). */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="state" role="status">
      {label}
    </p>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <p className="state" role="alert">
      {message}
    </p>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="state">{message}</p>;
}
