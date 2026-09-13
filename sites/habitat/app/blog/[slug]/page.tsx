import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { getPost } from '@/lib/posts';
import { formatDate } from '@/lib/utils';

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getPost('blog', params.slug);

  if (!post) {
    notFound();
  }

  return (
    <div className="space-y-8 py-12">
      <article className="prose">
        <p className="eyebrow text-[var(--gold)] text-xs font-bold uppercase tracking-widest mb-4">
          Blog
        </p>
        <h1 className="font-display text-3xl md:text-4xl font-bold mb-4">{post.title}</h1>
        <p className="text-[var(--ink-soft)] -mt-6 mb-8">{formatDate(post.date)}</p>
        
        <div className="border-t border-[var(--rule)] pt-8">
          <ReactMarkdown className="prose max-w-none">{post.content}</ReactMarkdown>
        </div>

        {post.tags && post.tags.length > 0 && (
          <div className="flex gap-2 pt-4">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 bg-[var(--cobalt-wash)] text-[var(--cobalt)] text-sm rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </article>

      <div className="border-t border-[var(--rule)] pt-8">
        <p className="text-[var(--ink-soft)] text-sm">
          Cet article est figé dans le temps. Tu peux le commenter ou le partager.
        </p>
      </div>
    </div>
  );
}
