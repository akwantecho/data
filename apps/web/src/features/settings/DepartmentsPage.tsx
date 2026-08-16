import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { BranchSummary, DepartmentSummary } from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { describeApiError } from '../../lib/errors';
import {
  createDepartment,
  deleteDepartment,
  fetchBranches,
  fetchDepartments,
  settingsKeys,
  updateDepartment,
} from './settings-api';
import { SettingsLayout } from './SettingsLayout';

interface DepartmentForm {
  name: string;
  code: string;
  branchId: string;
}

export function DepartmentsPage() {
  const { activeMembership } = useSession();
  const canEdit = activeMembership?.role === 'ORGANIZATION_ADMIN';
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<DepartmentSummary | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const departmentsQuery = useQuery({
    queryKey: settingsKeys.departments(true),
    queryFn: () => fetchDepartments(true),
  });
  const branchesQuery = useQuery({
    queryKey: settingsKeys.branches(false),
    queryFn: () => fetchBranches(false),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['departments'] });

  const saveMutation = useMutation({
    mutationFn: (input: { id?: string; values: DepartmentForm }) => {
      const payload = {
        name: input.values.name,
        code: input.values.code,
        branchId: input.values.branchId || null,
      };

      return input.id ? updateDepartment(input.id, payload) : createDepartment(payload);
    },
    onSuccess: async () => {
      setEditing(null);
      await invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDepartment,
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
    },
    onError: (error) => setActionError(describeApiError(error)),
  });

  return (
    <SettingsLayout
      title="Departments"
      description="Functional units such as Sales, Operations or Finance, optionally tied to one branch."
    >
      <section className="card stack">
        <div className="section-header">
          <h2 className="card__title">All departments</h2>
          {canEdit ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setActionError(null);
                setEditing('new');
              }}
            >
              Add department
            </button>
          ) : null}
        </div>

        {departmentsQuery.isPending ? <LoadingState label="Loading departments…" /> : null}
        {departmentsQuery.isError ? (
          <ErrorState message={describeApiError(departmentsQuery.error)} />
        ) : null}
        {actionError ? <ErrorState message={actionError} /> : null}

        {departmentsQuery.data?.length === 0 ? <EmptyState message="No departments yet." /> : null}

        {departmentsQuery.data && departmentsQuery.data.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col">Branch</th>
                <th scope="col">Status</th>
                {canEdit ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {departmentsQuery.data.map((department) => (
                <tr key={department.id}>
                  <td>
                    {department.name}
                    <span className="data-table__meta">{department.code}</span>
                  </td>
                  <td>{department.branchName ?? 'Organization-wide'}</td>
                  <td>
                    <span
                      className={`badge ${
                        department.isActive ? 'badge--positive' : 'badge--negative'
                      }`}
                    >
                      {department.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canEdit ? (
                    <td className="data-table__actions">
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => {
                          setActionError(null);
                          setEditing(department);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--danger"
                        onClick={() => deleteMutation.mutate(department.id)}
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
        <DepartmentDialog
          department={editing === 'new' ? null : editing}
          branches={branchesQuery.data ?? []}
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

function DepartmentDialog({
  department,
  branches,
  isSaving,
  error,
  onCancel,
  onSubmit,
}: {
  department: DepartmentSummary | null;
  branches: BranchSummary[];
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: DepartmentForm) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DepartmentForm>({
    defaultValues: {
      name: department?.name ?? '',
      code: department?.code ?? '',
      branchId: department?.branchId ?? '',
    },
  });

  return (
    <Modal title={department ? 'Edit department' : 'Add department'} onClose={onCancel}>
      <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Name" htmlFor="department-name" error={errors.name?.message}>
          <input
            id="department-name"
            className="form-field__input"
            {...register('name', {
              required: 'Name is required',
              minLength: { value: 2, message: 'Name must be at least 2 characters' },
            })}
          />
        </FormField>

        <FormField
          label="Code"
          htmlFor="department-code"
          hint="Used by CSV imports."
          error={errors.code?.message}
        >
          <input
            id="department-code"
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
          label="Branch"
          htmlFor="department-branch"
          hint="Leave empty for an organization-wide department."
        >
          <select id="department-branch" className="form-field__input" {...register('branchId')}>
            <option value="">Organization-wide</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </FormField>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save department'}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
