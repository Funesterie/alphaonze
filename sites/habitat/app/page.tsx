import Link from 'next/link';
import { getAllPosts } from '@/lib/posts';

export default function Home() {
  const { garden, blog, projects } = getAllPosts();

  return (
    <div className="space-y-16 py-12">
      {/* Hero */}
      <section className="space-y-6">
        <p className="eyebrow text-[var(--gold)] text-xs font-bold uppercase tracking-widest">
          Bienvenue dans l'Habitat Numérique
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight">
          Un espace pour cultiver,
          <br />
          <span className="text-[var(--gold)]">construire et partager.</span>
        </h1>
        <p className="chapeau text-[var(--ink-soft)] text-lg max-w-2xl">
          Ici, chaque pièce a son usage : le Garden pour les idées en croissance,
          le Blog pour les réflexions abouties, et les Projects pour les builds concrets.
          LightKamel, assoiffé de succès, est là pour te guider.
        </p>
      </section>

      {/* Garden Preview */}
      <section className="border-t border-[var(--rule)] pt-10">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-display text-2xl font-bold">🌱 Garden</h2>
          <Link
            href="/garden"
            className="text-sm text-[var(--gold)] hover:text-[var(--cobalt)] transition-colors"
          >
            Tout explorer →
          </Link>
        </div>
        <p className="text-[var(--ink-soft)] mb-6 max-w-xl">
          Notes brutes, idées en vrac, graines de projets. Ici, tout peut pousser.
        </p>
        {garden.length > 0 ? (
          <div className="grid gap-4">
            {garden.slice(0, 3).map((post) => (
              <Link
                key={post.slug}
                href={`/garden/${post.slug}`}
                className="block p-4 rounded-lg border border-[var(--rule)] hover:border-[var(--gold)] transition-colors bg-[var(--surface)]"
              >
                <h3 className="font-medium text-[var(--ink)] mb-1">{post.title}</h3>
                <p className="text-sm text-[var(--ink-soft)] line-clamp-2">{post.excerpt}</p>
                <span className="text-xs text-[var(--laurel)] mt-2 block">
                  {post.date}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[var(--ink-soft)] text-sm italic">
            Le Garden est vide pour l'instant. Ajoute des notes en Markdown dans /content/garden/
          </p>
        )}
      </section>

      {/* Blog Preview */}
      <section className="border-t border-[var(--rule)] pt-10">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-display text-2xl font-bold">✍️ Blog</h2>
          <Link
            href="/blog"
            className="text-sm text-[var(--gold)] hover:text-[var(--cobalt)] transition-colors"
          >
            Tout lire →
          </Link>
        </div>
        <p className="text-[var(--ink-soft)] mb-6 max-w-xl">
          Articles aboutis, réflexions structurées, histoires à partager.
        </p>
        {blog.length > 0 ? (
          <div className="grid gap-4">
            {blog.slice(0, 3).map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block p-4 rounded-lg border border-[var(--rule)] hover:border-[var(--gold)] transition-colors bg-[var(--surface)]"
              >
                <h3 className="font-medium text-[var(--ink)] mb-1">{post.title}</h3>
                <p className="text-sm text-[var(--ink-soft)] line-clamp-2">{post.excerpt}</p>
                <span className="text-xs text-[var(--laurel)] mt-2 block">
                  {post.date}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[var(--ink-soft)] text-sm italic">
            Le Blog est vide pour l'instant. Ajoute des articles en Markdown dans /content/blog/
          </p>
        )}
      </section>

      {/* Projects Preview */}
      <section className="border-t border-[var(--rule)] pt-10">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-display text-2xl font-bold">🛠️ Projects</h2>
          <Link
            href="/projects"
            className="text-sm text-[var(--gold)] hover:text-[var(--cobalt)] transition-colors"
          >
            Tout voir →
          </Link>
        </div>
        <p className="text-[var(--ink-soft)] mb-6 max-w-xl">
          Builds concrets, projets aboutis, outils créés.
        </p>
        {projects.length > 0 ? (
          <div className="grid gap-4">
            {projects.slice(0, 3).map((post) => (
              <Link
                key={post.slug}
                href={`/projects/${post.slug}`}
                className="block p-4 rounded-lg border border-[var(--rule)] hover:border-[var(--gold)] transition-colors bg-[var(--surface)]"
              >
                <h3 className="font-medium text-[var(--ink)] mb-1">{post.title}</h3>
                <p className="text-sm text-[var(--ink-soft)] line-clamp-2">{post.excerpt}</p>
                <span className="text-xs text-[var(--laurel)] mt-2 block">
                  {post.date}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[var(--ink-soft)] text-sm italic">
            Aucun projet pour l'instant. Ajoute-en en Markdown dans /content/projects/
          </p>
        )}
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--rule)] pt-10 text-center">
        <p className="text-[var(--ink-soft)] mb-4">
          Prêt à explorer ?
        </p>
        <p className="text-[var(--gold)] font-medium">
          Clique sur LightKamel en bas à droite pour commencer la visite guidée.
        </p>
      </section>
    </div>
  );
}
