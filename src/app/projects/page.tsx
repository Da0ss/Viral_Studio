import { RouteIntro } from '@/components/route-intro';
import { projects } from '@/lib/mock-data';

export default function ProjectsPage() { return <RouteIntro title="ПРОЕКТЫ"><p className="subtitle">Идеи, которые двигают бизнес.</p><div className="migration-list">{projects.map((project) => <article key={project.id}><b>{project.title}</b><span>{project.description} · {project.status}</span></article>)}</div></RouteIntro>; }
