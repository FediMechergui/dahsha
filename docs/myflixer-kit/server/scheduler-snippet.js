      // Myflixer documentary catalog (WordPress REST API)
      for (const src of myflixerJobs) {
        try {
          const key = `MYFLIXER:${src.id}`;
          const cached = this.playlists[key];
          if (!full && cached && cached.videos?.length && (Date.now() - new Date(cached.fetchedAt || 0).getTime() < 3 * 3600e3)) {
            tick();
            continue;
          }
          const { films, series } = await fetchMyflixerCatalog(src, { maxPages: src.maxPages || 60 });
          const videos = [];
          for (const f of films) {
            const v = {
              id: f.id,
              title: f.title,
              showTitle: f.title,
              episodeTitle: 'Full film',
              parsed: { showTitle: f.title, episodeTitle: 'Full film', kind: 'film', number: null, season: null },
              durationSec: f.durationSec,
              durationText: '1:30:00',
              views: f.views,
              thumb: f.thumb,
              tags: f.tags,
              sourceUrl: f.sourceUrl,
              embedUrl: f.sourceUrl,
            };
            videos.push(v);
            this.details[f.id] = {
              id: f.id,
              title: f.title,
              description: f.synopsis,
              durationSec: f.durationSec,
              viewCount: f.views,
              publishedAt: f.publishedAt,
              sourceUrl: f.sourceUrl,
              embedUrl: f.sourceUrl,
              thumb: f.thumb,
              playable: true,
              fetchedAt: new Date().toISOString(),
            };
          }
          for (const s of series) {
            for (const ep of s.episodes) {
              const epId = `mf:e:${ep.slug}`;
              const epUrl = `https://myflixerz.day/episodes/${ep.slug}/`;
              const v = {
                id: epId,
                title: `${s.title} - S${ep.season}E${ep.episode}: ${ep.title}`,
                showTitle: s.title,
                episodeTitle: ep.title,
                parsed: { showTitle: s.title, episodeTitle: ep.title, kind: 'series', number: ep.episode, season: ep.season },
                durationSec: 3000,
                durationText: '50:00',
                views: 50000,
                thumb: s.thumb,
                tags: s.tags,
                sourceUrl: epUrl,
                embedUrl: epUrl,
              };
              videos.push(v);
              this.details[epId] = {
                id: epId,
                title: ep.title,
                description: s.synopsis,
                durationSec: 3000,
                viewCount: 50000,
                publishedAt: s.publishedAt,
                sourceUrl: epUrl,
                embedUrl: epUrl,
                thumb: s.thumb,
                playable: true,
                fetchedAt: new Date().toISOString(),
              };
            }
          }
          this.playlists[key] = {
            id: key,
            title: src.title,
            sourceId: src.id,
            signature: `${videos.length}`,
            videos,
            fetchedAt: new Date().toISOString(),
          };
          tick();
        } catch (err) {
          console.warn(`[catalogue] myflixer fetch error: ${err.message}`);
          tick();
        }
