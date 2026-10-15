# The PDF converter: Gotenberg's LibreOffice image, with Microsoft's core fonts added (owner, 15 October 2026: "keep
# the uploaded document format … just fill in the data"). The templates are set in Arial and Times New Roman, the
# Arabic text too; LibreOffice's stand-ins for them have no Arabic letters, so Arabic came out in another font and the
# lines and pages moved. Debian's ttf-mscorefonts-installer downloads the fonts Microsoft distributes for free (Arial,
# Times New Roman, Courier New, Georgia, Verdana, Trebuchet MS …) and accepts their licence here. A font the image
# still lacks (e.g. Segoe UI) is printed in the nearest one it has.
#
# The install is best effort: if the download fails, the image is still built, the converter as it was without these
# fonts, so a deploy is never stopped by it. The build log says which fonts came.
FROM gotenberg/gotenberg:8.37.0-libreoffice

USER root
RUN ( \
      set -ux; \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i -E '/contrib/! s/^(Components: .*main)$/\1 contrib/' /etc/apt/sources.list.d/debian.sources; \
      fi; \
      if [ -f /etc/apt/sources.list ]; then sed -i -E '/contrib/! s/^(deb .* main)$/\1 contrib/' /etc/apt/sources.list; fi; \
      apt-get update && \
      echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ttf-mscorefonts-installer wget cabextract fontconfig && \
      fc-cache -f \
    ) || echo "WARNING: Microsoft core fonts could not be installed; the converter keeps its own fonts."; \
    (fc-list | grep -iE "arial|times new roman" | head -5) || echo "Microsoft core fonts: none installed"; \
    rm -rf /var/lib/apt/lists/*
USER gotenberg
