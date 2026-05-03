import type { SkillConfig } from "../skills/index.js";

import hnTopStories from "./data/hn-top-stories.json" with { type: "json" };
import githubTrending from "./data/github-trending.json" with { type: "json" };
import jobListingsGreenhouse from "./data/job-listings-greenhouse.json" with { type: "json" };
import ecommerceProduct from "./data/ecommerce-product.json" with { type: "json" };
import productReviews from "./data/product-reviews.json" with { type: "json" };
import cryptoWebsocket from "./data/crypto-websocket.json" with { type: "json" };
import newsArticleReader from "./data/news-article-reader.json" with { type: "json" };
import redditPosts from "./data/reddit-posts.json" with { type: "json" };
import seoPageAudit from "./data/seo-page-audit.json" with { type: "json" };
import socialMediaMentions from "./data/social-media-mentions.json" with { type: "json" };
import influencerNicheDiscovery from "./data/influencer-niche-discovery.json" with { type: "json" };
import influencerHashtagScout from "./data/influencer-hashtag-scout.json" with { type: "json" };
import influencerCompetitorSpy from "./data/influencer-competitor-spy.json" with { type: "json" };
import influencerContentScout from "./data/influencer-content-scout.json" with { type: "json" };

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
  influencerNicheDiscovery,
  influencerHashtagScout,
  influencerCompetitorSpy,
  influencerContentScout,
] as SkillConfig[];
