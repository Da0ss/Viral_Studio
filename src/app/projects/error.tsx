'use client';
export default function ProjectsError({ reset }: { error: Error; reset: () => void }) { return <main className="page loading-page"><h1>ОШИБКА ЗАГРУЗКИ</h1><button className="cta" onClick={reset}><span>Повторить</span></button></main>; }
