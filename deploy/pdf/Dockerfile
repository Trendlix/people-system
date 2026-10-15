# The PDF converter: Gotenberg's LibreOffice image, with Microsoft's core fonts added (owner, 15 October 2026: "keep
# the uploaded document format … just fill in the data"). The templates are set in Arial and Times New Roman, the
# Arabic text too; LibreOffice's stand-ins for them have no Arabic letters, so Arabic came out in another font and the
# lines and pages moved. Debian's ttf-mscorefonts-installer downloads the fonts Microsoft distributes for free (Arial,
# Times New Roman, Courier New, Georgia, Verdana, Trebuchet MS …) and accepts their licence here. A font the image
# still lacks (e.g. Segoe UI) is printed in the nearest one it has.
#
# Aptos, Word's default font since 2023 (the owner's job offer template is set in it), is not among them: it comes
# from Microsoft's own download (microsoft.com/download id 106087), checked against its SHA-256. Its licence lets the
# company install it on its own devices but not hand the font files on, so they are fetched here, never kept in the
# repository.
#
# The installs are best effort: if a download fails, the image is still built, the converter as it was without those
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
    ( \
      set -ux; \
      apt-get install -y --no-install-recommends unzip curl ca-certificates && \
      curl -fsSL -o /tmp/aptos.zip "https://download.microsoft.com/download/8/6/0/860a94fa-7feb-44ef-ac79-c072d9113d69/Microsoft%20Aptos%20Fonts.zip" && \
      echo "6528fd120e719a9f985e94214eca6887d1653b88456916a792a630b02e95b025  /tmp/aptos.zip" | sha256sum -c - && \
      mkdir -p /usr/share/fonts/truetype/aptos && \
      unzip -o -j /tmp/aptos.zip '*.ttf' -d /usr/share/fonts/truetype/aptos && \
      fc-cache -f \
    ) || echo "WARNING: Aptos could not be installed; the converter keeps its own fonts."; \
    rm -f /tmp/aptos.zip; \
    (fc-list | grep -iE "arial|times new roman|aptos" | head -8) || echo "Microsoft fonts: none installed"; \
    rm -rf /var/lib/apt/lists/*
USER gotenberg
