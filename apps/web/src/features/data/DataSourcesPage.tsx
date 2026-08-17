import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { DATA_SOURCE_TYPES, type DataSourceType } from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { describeApiError } from '../../lib/errors';
import {
  createDataSource,
  dataKeys,
  deleteDataSource,
  fetchDataSources,
  updateDataSource,
} from './data-api';
import { DataLayout } from './DataLayout';

interface SourceForm {
  name: string;
  type: DataSourceType;
}

export function DataSourcesPage() {
  const { activeMembership } = useSession();
  const role = activeMembership?.role;
  const canEdit = role === 'ORGANIZATION_ADMIN' || role === 'ANALYST';
  const canDelete = role === 'ORGANIZATION_ADMIN';
  const queryClient = useQueryClient();

  const [isAdding, setIsAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const sourcesQuery = useQuery({ queryKey: dataKeys.sources, queryFn: fetchDataSources });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: dataKeys.sources });

  const createMutation = useMutation({
    mutationFn: createDataSource,
    onSuccess: async () => {
      setIsAdding(false);
      await invalidate();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (input: { id: string; status: 'ACTIVE' | 'INACTIVE' }) =>
      updateDataSource(input.id, { status: input.status }),
    onSuccess: invalidate,
    onError: (error) => setActionError(describeApiError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDataSource,
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
    },
    onError: (error) => setActionError(describeApiError(error)),
  });

  return (
    <DataLayout
      title="Data Sources"
      description="Where this organization's numbers come from. Manual entry and CSV upload today; connectors later."
    >
      <section className="card stack">
        <div className="section-header">
          <h2 className="card__title">All sources</h2>
          {canEdit ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setActionError(null);
                setIsAdding(true);
              }}
            >
              Add source
            </button>
          ) : null}
        </div>

        {sourcesQuery.isPending ? <LoadingState label="Loading sources…" /> : null}
        {sourcesQuery.isError ? (
          <ErrorState message={describeApiError(sourcesQuery.error)} />
        ) : null}
        {actionError ? <ErrorState message={actionError} /> : null}
        {sourcesQuery.data?.length === 0 ? (
          <EmptyState message="No data sources yet. Add one to record where your imports come from." />
        ) : null}

        {sourcesQuery.data && sourcesQuery.data.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Type</th>
                <th scope="col">Imports</th>
                <th scope="col">Last sync</th>
                <th scope="col">Status</th>
                {canEdit ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {sourcesQuery.data.map((source) => (
                <tr key={source.id}>
                  <td>{source.name}</td>
                  <td>{source.type}</td>
                  <td>{source.importCount}</td>
                  <td>
                    {source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        source.status === 'ACTIVE' ? 'badge--positive' : 'badge--negative'
                      }`}
                    >
                      {source.status}
                    </span>
                  </td>
                  {canEdit ? (
                    <td className="data-table__actions">
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() =>
                          toggleMutation.mutate({
                            id: source.id,
                            status: source.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                          })
                        }
                      >
                        {source.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </button>
                      {canDelete ? (
                        <button
                          type="button"
                          className="button button--ghost button--danger"
                          onClick={() => deleteMutation.mutate(source.id)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {isAdding ? (
        <SourceDialog
          isSaving={createMutation.isPending}
          error={createMutation.isError ? describeApiError(createMutation.error) : null}
          onCancel={() => setIsAdding(false)}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      ) : null}
    </DataLayout>
  );
}

function SourceDialog({
  isSaving,
  error,
  onCancel,
  onSubmit,
}: {
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: SourceForm) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SourceForm>({ defaultValues: { name: '', type: 'CSV' } });

  return (
    <Modal title="Add data source" onClose={onCancel}>
      <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Name" htmlFor="source-name" error={errors.name?.message}>
          <input
            id="source-name"
            className="form-field__input"
            {...register('name', {
              required: 'Name is required',
              minLength: { value: 2, message: 'Name must be at least 2 characters' },
            })}
          />
        </FormField>

        <FormField label="Type" htmlFor="source-type">
          <select id="source-type" className="form-field__input" {...register('type')}>
            {DATA_SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
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
            {isSaving ? 'Saving…' : 'Save source'}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
