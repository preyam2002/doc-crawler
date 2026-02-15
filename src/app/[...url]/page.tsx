import Crawler from '@/components/Crawler';

interface Props {
  params: Promise<{ url: string[] }>;
}

export default async function CatchAllPage({ params }: Props) {
  const resolvedParams = await params;
  const slug = resolvedParams.url;
  
  if (!slug || slug.length === 0) {
    return <Crawler />;
  }

  // Reconstruct URL
  let rawUrl = slug.join('/');
  
  // Fix protocol double slash issue (Next.js/Browsers often merge // to /)
  // If it starts with "https:/example", make it "https://example"
  if (rawUrl.match(/^(https?):\/(?!\/)/)) {
    rawUrl = rawUrl.replace(/^(https?):\//, '$1://');
  } 
  // If no protocol, add https://
  else if (!rawUrl.startsWith('http')) {
    rawUrl = 'https://' + rawUrl;
  }

  // Decode URI component just in case
  try {
    rawUrl = decodeURIComponent(rawUrl);
  } catch {}

  return <Crawler initialUrl={rawUrl} autoStart={true} />;
}
