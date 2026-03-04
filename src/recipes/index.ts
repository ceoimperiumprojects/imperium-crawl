import type { SkillConfig } from "../skills/manager.js";

import hnTopStories from "./hn-top-stories.json" with { type: "json" };
import githubTrending from "./github-trending.json" with { type: "json" };
import jobListingsGreenhouse from "./job-listings-greenhouse.json" with { type: "json" };
import ecommerceProduct from "./ecommerce-product.json" with { type: "json" };
import productReviews from "./product-reviews.json" with { type: "json" };
import cryptoWebsocket from "./crypto-websocket.json" with { type: "json" };
import newsArticleReader from "./news-article-reader.json" with { type: "json" };
import redditPosts from "./reddit-posts.json" with { type: "json" };
import seoPageAudit from "./seo-page-audit.json" with { type: "json" };
import socialMediaMentions from "./social-media-mentions.json" with { type: "json" };

export const builtinRecipes: SkillConfig[] = [
  hnTopStories,
  githubTrending,
  jobListingsGreenhouse,
  ecommerceProduct,
  productReviews,
  cryptoWebsocket,
  newsArticleReader,
  redditPosts,
  seoPageAudit,
  socialMediaMentions,
] as SkillConfig[];
