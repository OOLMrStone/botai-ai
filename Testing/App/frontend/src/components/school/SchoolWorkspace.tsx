'use client';

import { B2bLogin } from '@/components/b2b/B2bLogin';
import { ErrorNote } from '@/components/common/ErrorNote';
import { SchoolHeader } from '@/components/school/SchoolHeader';
import { SchoolAssignments } from '@/components/school/SchoolAssignments';
import { SchoolAssignment } from '@/components/school/SchoolAssignment';
import { SCHOOL_COPY as C } from '@/config/school';
import { layout } from '@/config/layout';
import { useB2bLogin } from '@/hooks/use-b2b-login';
import { useSchoolWorkspace } from '@/hooks/use-school-workspace';
import { SESSION_COPY } from '@/config/navigation';

export function SchoolWorkspace() {
  const workspace = useSchoolWorkspace();
  const login = useB2bLogin(workspace.login);

  return (
    <div className={layout.school.root}>
      <SchoolHeader workspace={workspace} />
      {workspace.loading ? (
        <main className={layout.school.main}>
          <p role="status">{C.loading}</p>
        </main>
      ) : !workspace.sessionResolved ? (
        <main className={layout.school.main}>
          <ErrorNote
            title={SESSION_COPY.errorTitle}
            message={workspace.error ?? SESSION_COPY.errorDescription}
            onRetry={() => void workspace.refresh()}
            retryLabel={C.refresh}
          />
        </main>
      ) : !workspace.session ? (
        <B2bLogin
          title={C.product}
          subtitle={C.loginSubtitle}
          email={login.email}
          password={login.password}
          busy={workspace.busy}
          error={workspace.error}
          onEmailChange={login.setEmail}
          onPasswordChange={login.setPassword}
          onSubmit={() => void login.submit()}
        />
      ) : (
        <main className={layout.school.main}>
          {workspace.error ? (
            <ErrorNote
              message={workspace.error}
              onRetry={() => void workspace.refresh()}
              retryLabel={C.refresh}
            />
          ) : null}
          {workspace.opening ? (
            <p role="status">{C.loadingTask}</p>
          ) : workspace.assignment ? (
            <SchoolAssignment
              assignment={workspace.assignment}
              busy={workspace.busy}
              onBack={workspace.back}
              showSchool={workspace.session.schools.length > 1}
            />
          ) : (
            <SchoolAssignments workspace={workspace} />
          )}
        </main>
      )}
    </div>
  );
}
