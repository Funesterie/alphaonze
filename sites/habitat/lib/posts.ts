import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

// Chemin vers le dossier content
const contentDir = path.join(process.cwd(), 'sites', 'habitat', 'content');

export interface Post {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  content: string;
  tags?: string[];
}

// Lire tous les fichiers Markdown d'un dossier
function readPostsFromDir(dir: string): Post[] {
  const fullPath = path.join(contentDir, dir);
  
  if (!fs.existsSync(fullPath)) {
    return [];
  }

  const files = fs.readdirSync(fullPath);
  const posts: Post[] = [];

  for (const file of files) {
    if (file.endsWith('.md') || file.endsWith('.mdx')) {
      const filePath = path.join(fullPath, file);
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const { data, content } = matter(fileContent);

      const slug = file.replace(/\.(md|mdx)$/, '');
      
      posts.push({
        slug,
        title: data.title || slug,
        excerpt: data.excerpt || content.substring(0, 160) + '...',
        date: data.date || new Date().toISOString().split('T')[0],
        content,
        tags: data.tags ? (Array.isArray(data.tags) ? data.tags : [data.tags]) : [],
      });
    }
  }

  // Trier par date (plus récent en premier)
  return posts.sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

// Récupérer tous les posts par catégorie
export function getAllPosts() {
  const garden = readPostsFromDir('garden');
  const blog = readPostsFromDir('blog');
  const projects = readPostsFromDir('projects');

  return { garden, blog, projects };
}

// Récupérer un post spécifique
export function getPost(category: string, slug: string): Post | null {
  const posts = readPostsFromDir(category);
  return posts.find((post) => post.slug === slug) || null;
}

// Récupérer tous les posts d'une catégorie
export function getPostsByCategory(category: string): Post[] {
  return readPostsFromDir(category);
}
