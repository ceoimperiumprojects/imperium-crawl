/**
 * Shared types for social media tools (YouTube, Reddit, Instagram).
 */

export interface SocialVideo {
  id: string;
  title: string;
  url: string;
  thumbnail?: string;
  duration?: string;
  views?: number;
  likes?: number;
  author: string;
  author_url?: string;
  published?: string;
  description?: string;
}

export interface SocialPost {
  id: string;
  title: string;
  url: string;
  author: string;
  score?: number;
  comments_count?: number;
  published?: string;
  subreddit?: string;
  text?: string;
  thumbnail?: string;
  is_video?: boolean;
  flair?: string;
}

export interface SocialComment {
  id: string;
  author: string;
  text: string;
  score?: number;
  published?: string;
  replies_count?: number;
}

export interface SocialProfile {
  name: string;
  url: string;
  description?: string;
  subscribers?: number;
  avatar?: string;
  verified?: boolean;
  video_count?: number;
  created?: string;
}

export interface SocialSearchResult<T> {
  query?: string;
  platform: "youtube" | "reddit" | "instagram";
  results: T[];
  total?: number;
}

export interface InstagramProfile extends SocialProfile {
  username: string;
  followers: number;
  following: number;
  posts_count: number;
  is_business: boolean;
  business_email?: string;
  engagement_rate: number;
  recent_posts: InstagramPost[];
}

export interface InstagramPost {
  id: string;
  url: string;
  likes: number;
  comments: number;
  caption?: string;
  timestamp: string;
  is_video: boolean;
}

export interface InstagramDiscoverResult {
  query: string;
  location?: string;
  filters: { min_followers: number; max_followers: number; min_engagement: number };
  profiles: InstagramProfile[];
  total_scanned: number;
  total_matched: number;
}
