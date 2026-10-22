'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useAuthStore } from '@/stores/auth-store';
import { useAdminSubmissions, useAdminDetail } from '@/hooks/use-admin-submissions';
import { LEARNING_COPY as C, LEARNING_ROUTES, DATE_FORMAT } from '@/config/integration';
import { layout } from '@/config/layout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/common/ErrorNote';
import { AppCard } from '@/components/app/AppCard';
export function AdminSubmissions() {
  const state = useAdminSubmissions();
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'ADMIN') return <p className={layout.typography.description}>{C.adminDenied}</p>;
  return (
    <div className={layout.integration.stack}>
      <div className={layout.integration.filters}>
        <label className={layout.settings.fieldGroup}>
          <span>{C.adminStatus}</span>
          <select
            className={layout.control.sizes.default}
            value={state.draft.status ?? ''}
            onChange={(event) => state.change('status', event.target.value)}
          >
            <option value="">{C.all}</option>
            {Object.entries(C.status).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={layout.settings.fieldGroup}>
          <span>{C.adminOwner}</span>
          <Input
            value={state.draft.userId ?? ''}
            onChange={(event) => state.change('userId', event.target.value)}
          />
        </label>
        <label className={layout.settings.fieldGroup}>
          <span>{C.adminFrom}</span>
          <Input
            type="datetime-local"
            value={state.draft.from ?? ''}
            onChange={(event) => state.change('from', event.target.value)}
          />
        </label>
        <label className={layout.settings.fieldGroup}>
          <span>{C.adminTo}</span>
          <Input
            type="datetime-local"
            value={state.draft.to ?? ''}
            onChange={(event) => state.change('to', event.target.value)}
          />
        </label>
      </div>
      <Button onClick={state.apply}>{C.filter}</Button>
      {state.failed ? (
        <ErrorNote message={C.loadError} onRetry={state.retry} />
      ) : state.data ? (
        state.data.items.map((item) => (
          <AppCard key={item.id}>
            <Link href={LEARNING_ROUTES.adminDetail(item.id)}>
              {item.user.displayName ?? item.user.email} · {C.status[item.status]}
            </Link>
            <p className={layout.typography.caption}>
              {DATE_FORMAT.format(new Date(item.createdAt))} · {item.id}
            </p>
            {item.result ? (
              <p className={layout.typography.description}>
                {item.result.score === null
                  ? C.noScore
                  : C.score(item.result.score, item.result.maxScore)}
              </p>
            ) : null}
          </AppCard>
        ))
      ) : (
        <p>{C.loading}</p>
      )}
      {state.data?.items.length === 0 ? (
        <p className={layout.typography.description}>{C.empty}</p>
      ) : null}
      {state.data?.nextCursor ? (
        <Button variant="outline" onClick={state.next}>
          {C.more}
        </Button>
      ) : null}
    </div>
  );
}
export function AdminSubmissionDetail({ id }: { id: string }) {
  const state = useAdminDetail(id);
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'ADMIN') return <p className={layout.typography.description}>{C.adminDenied}</p>;
  if (!state.data)
    return state.failed ? (
      <ErrorNote message={C.loadError} onRetry={state.retry} />
    ) : (
      <p>{C.loading}</p>
    );
  const { submission, user, events, exactResponse } = state.data;
  return (
    <div className={layout.integration.stack}>
      <AppCard>
        <p>
          {user.displayName ?? user.email} · {C.status[submission.status]}
        </p>
        <pre className={layout.integration.raw}>{JSON.stringify(submission.result, null, 2)}</pre>
        <div className={layout.integration.photos}>
          {submission.images.map((image) => (
            <a key={image.id} href={image.previewUrl} target="_blank" rel="noreferrer">
              <Image
                width={80}
                height={80}
                src={image.previewUrl}
                alt={image.fileName}
                className={layout.integration.preview}
              />
            </a>
          ))}
        </div>
      </AppCard>
      <AppCard>
        <p className={layout.typography.sectionTitle}>{C.adminEvents}</p>
        {events.map((event) => (
          <div key={event.id}>
            <p>
              {event.type} · {DATE_FORMAT.format(new Date(event.createdAt))}
            </p>
            <pre className={layout.integration.raw}>{JSON.stringify(event.metadata, null, 2)}</pre>
          </div>
        ))}
      </AppCard>
      <AppCard>
        <p className={layout.typography.sectionTitle}>{C.adminResult}</p>
        <pre className={layout.integration.raw}>{exactResponse ?? C.noScore}</pre>
      </AppCard>
    </div>
  );
}
