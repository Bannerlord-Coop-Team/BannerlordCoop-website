import { renderToStaticMarkup } from "react-dom/server";
import { VideoCarousel } from "../../src/app/components/home/media/VideoCarousel";
import { LocalizationProvider } from "../../src/app/lib/localization/client";
import home from "../../src/app/lib/localization/dictionaries/en/home.json";

const count = Number(process.argv[2]);
if (count !== 2 && count !== 3) throw new Error("Expected two grid videos or three carousel videos.");
const videos = Array.from({ length: count }, (_, index) => ({
    id: String(index), title: `Video ${index}`, thumbnail: "/images/banner.png",
    thumbnailAlt: `Thumbnail ${index}`, category: "Community", href: `https://example.com/video/${index}`,
    description: "", duration: null,
}));
process.stdout.write(renderToStaticMarkup(
    <LocalizationProvider locale="en" messages={{ home }}><VideoCarousel videos={videos} /></LocalizationProvider>,
));
