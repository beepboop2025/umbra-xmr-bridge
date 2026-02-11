use axum::http::{HeaderValue, Request, Response};
use pin_project_lite::pin_project;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use tower::{Layer, Service};

/// Tower layer that wraps services with [`SecurityHeadersService`].
#[derive(Debug, Clone, Copy)]
pub struct SecurityHeadersLayer;

impl<S> Layer<S> for SecurityHeadersLayer {
    type Service = SecurityHeadersService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        SecurityHeadersService { inner }
    }
}

/// Tower service that appends hardened security headers to every HTTP response.
#[derive(Debug, Clone, Copy)]
pub struct SecurityHeadersService<S> {
    inner: S,
}

impl<S, ReqBody, ResBody> Service<Request<ReqBody>> for SecurityHeadersService<S>
where
    S: Service<Request<ReqBody>, Response = Response<ResBody>>,
    S::Future: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = SecurityHeadersFuture<S::Future>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<ReqBody>) -> Self::Future {
        SecurityHeadersFuture {
            inner: self.inner.call(req),
        }
    }
}

pin_project! {
    /// Future returned by [`SecurityHeadersService`] that injects security
    /// headers once the inner future resolves.
    pub struct SecurityHeadersFuture<F> {
        #[pin]
        inner: F,
    }
}

impl<F, ResBody, E> Future for SecurityHeadersFuture<F>
where
    F: Future<Output = Result<Response<ResBody>, E>>,
{
    type Output = Result<Response<ResBody>, E>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.project();
        match this.inner.poll(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Err(e)) => Poll::Ready(Err(e)),
            Poll::Ready(Ok(mut response)) => {
                let headers = response.headers_mut();

                headers.insert(
                    "Content-Security-Policy",
                    HeaderValue::from_static("default-src 'self'; frame-ancestors 'none'"),
                );
                headers.insert(
                    "X-Frame-Options",
                    HeaderValue::from_static("DENY"),
                );
                headers.insert(
                    "X-Content-Type-Options",
                    HeaderValue::from_static("nosniff"),
                );
                headers.insert(
                    "Strict-Transport-Security",
                    HeaderValue::from_static("max-age=31536000; includeSubDomains"),
                );
                headers.insert(
                    "X-XSS-Protection",
                    HeaderValue::from_static("1; mode=block"),
                );
                headers.insert(
                    "Referrer-Policy",
                    HeaderValue::from_static("strict-origin-when-cross-origin"),
                );

                Poll::Ready(Ok(response))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    /// Minimal pass-through service for testing.
    #[derive(Clone)]
    struct Echo;

    impl Service<Request<Body>> for Echo {
        type Response = Response<Body>;
        type Error = std::convert::Infallible;
        type Future = std::future::Ready<Result<Self::Response, Self::Error>>;

        fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }

        fn call(&mut self, _req: Request<Body>) -> Self::Future {
            std::future::ready(Ok(Response::new(Body::empty())))
        }
    }

    #[tokio::test]
    async fn adds_security_headers() {
        let svc = SecurityHeadersLayer.layer(Echo);
        let req = Request::builder().body(Body::empty()).unwrap();
        let resp = svc.oneshot(req).await.unwrap();

        assert_eq!(
            resp.headers().get("X-Frame-Options").unwrap(),
            "DENY"
        );
        assert_eq!(
            resp.headers().get("X-Content-Type-Options").unwrap(),
            "nosniff"
        );
        assert!(resp.headers().contains_key("Content-Security-Policy"));
        assert!(resp.headers().contains_key("Strict-Transport-Security"));
        assert!(resp.headers().contains_key("X-XSS-Protection"));
        assert!(resp.headers().contains_key("Referrer-Policy"));
    }
}
