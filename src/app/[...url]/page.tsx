import Crawler from '@/components/Crawler';

interface Props {
  params: Promise<{ url?: string[] }>;
}

export default async function CatchAllPage({ params }: Props) {
  const resolved = await params;
  const slug = resolved.url;
  
  if (!slug || slug.length === 0) {
    return <Crawler />;
  }

  let rawUrl = slug.join('/');

  try {
    rawUrl = decodeURIComponent(rawUrl);
  } catch {}
  
  if (rawUrl.match(/^(https?):\/(?!\/)/)) {
    rawUrl = rawUrl.replace(/^(https?):\//, '$1://');
  } 
  else if (!rawUrl.startsWith('http')) {
    rawUrl = 'https://' + rawUrl;
  }

  return <Crawler initialUrl={rawUrl} autoStart={true} defaultShowMarkdown={true} />;
}
