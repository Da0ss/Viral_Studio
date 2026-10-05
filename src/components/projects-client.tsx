'use client';
import Link from 'next/link'; import type { Route } from 'next'; import { useActionState, useEffect, useRef, useState } from 'react'; import { createProject, deleteProject, updateProject } from '@/actions/projects'; import type { OrganizationOption, ProjectListItem } from '@/types/projects';
const statuses = ['draft','active','review','completed','archived'] as const; const types = ['ai','agency'] as const; const statusLabel: Record<string,string> = { draft:'Черновик',active:'В работе',review:'На проверке',completed:'Готов',archived:'Архив' };
export function ProjectsClient({ projects, organizations }: { projects: ProjectListItem[]; organizations: OrganizationOption[] }) { const [selected,setSelected]=useState<ProjectListItem|null>(null); const [creating,setCreating]=useState(false); return <><div className="project-actions"><button className="cta" type="button" onClick={()=>setCreating(true)} disabled={!organizations.some(o=>['owner','admin'].includes(o.role))}><span>Создать проект</span></button></div>{(creating||selected)&&<ProjectDialog project={selected} organizations={organizations} close={()=>{setCreating(false);setSelected(null);}}/>}{projects.length===0?<section className="projects-empty"><h2>ПРОЕКТОВ ПОКА НЕТ</h2><p>Создайте первый проект или измените параметры поиска.</p></section>:<div className="projects-grid">{projects.map(p=><article className="project-card" key={p.id}><small>{p.organizationName} · {p.type==='ai'?'AI':'Агентство'}</small><h2>{p.name}</h2><p>{p.description||'Без описания'}</p><footer><span>{statusLabel[p.status]}</span>{p.role&&<Link className="text-button" href={`/projects/${p.id}/chat` as Route}>Чат</Link>}{['owner','editor'].includes(p.role??'')&&<button className="text-button" onClick={()=>setSelected(p)}>Редактировать</button>}{p.role==='owner'&&<Delete project={p}/>}</footer></article>)}</div>}</>; }
function ProjectDialog({ project, organizations, close }: { project: ProjectListItem | null; organizations: OrganizationOption[]; close: () => void }) {
  const [state, action, pending] = useActionState(project ? updateProject : createProject, {});
  const dialog = useRef<HTMLDialogElement>(null);
  const allowed = project ? organizations.filter(o => o.id === project.organizationId) : organizations.filter(o => ['owner', 'admin'].includes(o.role));
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={dialog} className="project-dialog project-modal" aria-labelledby="project-dialog-title" onCancel={event => { event.preventDefault(); if (!pending) close(); }}>
    <form action={action} aria-busy={pending}>
      <input type="hidden" name="projectId" value={project?.id ?? ''} />
      <h2 id="project-dialog-title">{project ? 'РЕДАКТИРОВАТЬ' : 'НОВЫЙ ПРОЕКТ'}</h2>
      <label>Название<input name="name" defaultValue={project?.name} required minLength={2} maxLength={160} disabled={pending || Boolean(state.success)} autoFocus /></label>
      <label>Описание<textarea name="description" defaultValue={project?.description} maxLength={5000} disabled={pending || Boolean(state.success)} /></label>
      <label>Тип<select name="type" defaultValue={project?.type ?? 'ai'} disabled={pending || Boolean(state.success)}>{types.map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Статус<select name="status" defaultValue={project?.status ?? 'draft'} disabled={pending || Boolean(state.success)}>{statuses.map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Организация<select name="organizationId" defaultValue={project?.organizationId ?? allowed[0]?.id ?? ''} required disabled={Boolean(project) || pending || Boolean(state.success)}>{allowed.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      {state.error && <p role="alert">{state.error}</p>}
      {state.success && <p role="status">{state.success}</p>}
      <div><button type="button" className="ghost-button" onClick={close} disabled={pending}>{state.success ? 'Закрыть' : 'Отмена'}</button>{!state.success && <button className="cta" disabled={pending || !allowed.length}><span>{pending ? 'Сохраняем…' : 'Сохранить'}</span></button>}</div>
    </form>
  </dialog>;
}
function Delete({project}:{project:ProjectListItem}) { const [state,action,pending]=useActionState(deleteProject,{}); return <form action={action} onSubmit={e=>{if(!window.confirm(`Удалить проект «${project.name}»? Это действие нельзя отменить.`))e.preventDefault();}}><input type="hidden" name="projectId" value={project.id}/><button className="text-button danger" disabled={pending}>{pending?'Удаляем…':'Удалить'}</button>{state.error&&<small role="alert">{state.error}</small>}</form>; }
