import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { BranchSummary } from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { describeApiError } from '../../lib/errors';
import {
  createBranch,
  deleteBranch,
  fetchBranches,
  settingsKeys,
  updateBranch,
} from './settings-api';
import { SettingsLayout } from './SettingsLayout';

interface BranchForm {
  name: string;
  code: string;
  countryCode: string;
  timezone: string;
}

export function BranchesPage() {
  const { activeMembership } = useSession();
  const canEdit = activeMembership?.role === 'ORGANIZATION_ADMIN';
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<BranchSummary | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const branchesQuery = useQuery({
    queryKey: settingsKeys.branches(true),
    queryFn: () => fetchBranches(true),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['branches'] });

  const saveMutation = useMutation({
    mutationFn: (input: { id?: string; values: BranchForm }) => {
      const payload = {
        name: input.values.name,
        code: input.values.code,
        countryCode: input.values.countryCode || null,
        timezone: input.values.timezone || null,
      };

      return input.id ? updateBranch(input.id, payload) : createBranch(payload);
    },
    onSuccess: async () => {
      setEditing(null);
      await invalidate();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (branch: BranchSummary) => updateBranch(branch.id, { isActive: !branch.isActive }),
    onSuccess: invalidate,
    onError: (error) => setActionError(describeApiError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBranch,
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
    },
    onError: (error) => setActionError(describeApiError(error)),
  });

  return (
    <SettingsLayout
      title="Branches"
      description="Sites, clinics or portfolios inside the organization. Metrics can be reported per branch."
    >
      <section className="card stack">
        <div className="section-header">
          <h2 className="card__title">All branches</h2>
          {canEdit ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setActionError(null);
                setEditing('new');
              }}
            >
              Add branch
            </button>
          ) : null}
        </div>

        {branchesQuery.isPending ? <LoadingState label="Loading branches…" /> : null}
        {branchesQuery.isError ? (
          <ErrorState message={describeApiError(branchesQuery.error)} />
        ) : null}
        {actionError ? <ErrorState message={actionError} /> : null}

        {branchesQuery.data?.length === 0 ? (
          <EmptyState message="No branches yet. Add the first one to start reporting per site." />
        ) : null}

        {branchesQuery.data && branchesQuery.data.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Branch</th>
                <th scope="col">Country</th>
                <th scope="col">Timezone</th>
                <th scope="col">Departments</th>
                <th scope="col">Status</th>
                {canEdit ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {branchesQuery.data.map((branch) => (
                <tr key={branch.id}>
                  <td>
                    {branch.name}
                    <span className="data-table__meta">{branch.code}</span>
                  </td>
                  <td>{branch.countryCode ?? '—'}</td>
                  <td>{branch.timezone ?? '—'}</td>
                  <td>{branch.departmentCount}</td>
                  <td>
                    <span
                      className={`badge ${branch.isActive ? 'badge--positive' : 'badge--negative'}`}
                    >
                      {branch.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canEdit ? (
                    <td className="data-table__actions">
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => {
                          setActionError(null);
                          setEditing(branch);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => toggleMutation.mutate(branch)}
                      >
                        {branch.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--danger"
                        onClick={() => deleteMutation.mutate(branch.id)}
                      >
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {editing ? (
        <BranchDialog
          branch={editing === 'new' ? null : editing}
          isSaving={saveMutation.isPending}
          error={saveMutation.isError ? describeApiError(saveMutation.error) : null}
          onCancel={() => setEditing(null)}
          onSubmit={(values) =>
            saveMutation.mutate({ id: editing === 'new' ? undefined : editing.id, values })
          }
        />
      ) : null}
    </SettingsLayout>
  );
}

function BranchDialog({
  branch,
  isSaving,
  error,
  onCancel,
  onSubmit,
}: {
  branch: BranchSummary | null;
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: BranchForm) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BranchForm>({
    defaultValues: {
      name: branch?.name ?? '',
      code: branch?.code ?? '',
      countryCode: branch?.countryCode ?? '',
      timezone: branch?.timezone ?? '',
    },
  });

  return (
    <Modal title={branch ? 'Edit branch' : 'Add branch'} onClose={onCancel}>
      <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Name" htmlFor="branch-name" error={errors.name?.message}>
          <input
            id="branch-name"
            className="form-field__input"
            {...register('name', {
              required: 'Name is required',
              minLength: { value: 2, message: 'Name must be at least 2 characters' },
            })}
          />
        </FormField>

        <FormField
          label="Code"
          htmlFor="branch-code"
          hint="Used by CSV imports. Letters, numbers, hyphens and underscores."
          error={errors.code?.message}
        >
          <input
            id="branch-code"
            className="form-field__input"
            {...register('code', {
              required: 'Code is required',
              pattern: {
                value: /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
                message: 'Use letters, numbers, hyphens and underscores',
              },
              minLength: { value: 2, message: 'Code must be at least 2 characters' },
            })}
          />
        </FormField>

        <FormField
          label="Country"
          htmlFor="branch-country"
          hint="Optional. Two-letter ISO code."
          error={errors.countryCode?.message}
        >
          <input
            id="branch-country"
            className="form-field__input"
            {...register('countryCode', {
              pattern: { value: /^([A-Za-z]{2})?$/, message: 'Use a 2-letter ISO code' },
            })}
          />
        </FormField>

        <FormField
          label="Timezone"
          htmlFor="branch-timezone"
          hint="Optional. IANA name, for example Asia/Muscat."
        >
          <input id="branch-timezone" className="form-field__input" {...register('timezone')} />
        </FormField>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save branch'}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
