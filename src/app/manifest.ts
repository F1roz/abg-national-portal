import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AIESEC in Bangladesh — National Portal",
    short_name: "ABG Portal",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f4f6fa",
    theme_color: "#037ef3",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
