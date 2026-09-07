import { Router, type IRouter } from "express";
import { publicBaseUrl, renderPublicSitemap } from "../lib/public-sitemap";

const router: IRouter = Router();

router.get("/sitemap.xml", async (req, res): Promise<void> => {
  const sitemap = await renderPublicSitemap(publicBaseUrl(req));
  res
    .status(200)
    .set("Content-Type", "application/xml; charset=utf-8")
    .set("Cache-Control", "public, max-age=300, s-maxage=300")
    .set("X-Robots-Tag", "noindex")
    .send(sitemap);
});

export default router;