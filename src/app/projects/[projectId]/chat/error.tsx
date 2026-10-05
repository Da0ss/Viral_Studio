'use client';

export default function ChatError({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="page migration-page chat-page"><small>ЧАТ ПРОЕКТА</small><h1>ОШИБКА ЗАГРУЗКИ</h1><p className="subtitle">Не удалось открыть чат.</p><button className="cta" type="button" onClick={reset}><span>Повторить</span></button></main>; }
