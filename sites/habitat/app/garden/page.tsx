import Link from 'next/link';
import { getPostsByCategory } from '@/lib/posts';
import { formatDate } from '@/lib/utils';

export default function GardenPage() {
  const posts = getPostsByCategory('garden');

  return (
    <div className="space-y-10 py-12">
      <header>
        <p className="eyebrow text-[var(--gold)] text-xs font-bold uppercase tracking-widest mb-2">
          Garden
        </p>
        <h1 className="font-display text-4xl font-bold">🌱 Ici, les idées poussent</h1>
        <p className="text-[var(--ink-soft)] mt-4 max-w-2xl">
          Notes brutes, réflexions en cours, graines de projets. Comme dans un vrai jardin,
          tout peut changer, évoluer, ou disparaître. LightKamel veille.
        </p>
      </header>

      {posts.length > 0 ? (
        <div className="grid gap-6">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/garden/${post.slug}`}
              className="block p-6 rounded-lg border border-[var(--rule)] hover:border-[var(--gold)] transition-colors bg-[var(--surface)]"
            >
              <h2 className="font-display text-xl font-bold text-[var(--ink)] mb-2">
                {post.title}
              </h2>
              <p className="text-[var(--ink-soft)] mb-4">{post.excerpt}</p>
              <div className="flex justify-between items-center text-sm">
                <span className="text-[var(--laurel)]">{formatDate(post.date)}</span>
                {post.tags && (
                  <div className="flex gap-2">
                    {post.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-1 bg-[var(--cobalt-wash)] text-[var(--cobalt)] text-xs rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-[var(--ink-soft)]">Le Garden est vide.</p>
          <p className="text-sm text-[var(--ink-soft)] mt-2">
            Ajoute des notes en Markdown dans <code className="bg-[var(--ground)] px-2 py-1 rounded">content/garden/</code>
          </p>
        </div>
      )}
    </div>
  );
}
