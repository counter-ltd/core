/**
 Registration form: username, email, password, and optional display name.

 Shares `AuthViewModel` with `LoginView`. On success `AppEnvironment.didSignIn`
 is called which triggers `RootView` to switch to `MainTabView`.
 */

import SwiftUI

struct RegisterView: View {
    @Environment(\.counterTheme) private var theme
    @Bindable var vm: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            ScrollView {
                VStack(spacing: CounterSpacing.xl) {
                    Spacer(minLength: 20)

                    Text("Create account")
                        .font(CounterFont.heading(26))
                        .foregroundStyle(theme.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, CounterSpacing.xl)

                    VStack(spacing: CounterSpacing.md) {
                        TextField("Username", text: $vm.username)
                            .textContentType(.username)
                            .autocapitalization(.none)
                            .autocorrectionDisabled()
                            .counterInput()

                        TextField("Email", text: $vm.email)
                            .textContentType(.emailAddress)
                            .autocapitalization(.none)
                            .keyboardType(.emailAddress)
                            .counterInput()

                        SecureField("Password", text: $vm.password)
                            .textContentType(.newPassword)
                            .counterInput()

                        TextField("Display name (optional)", text: $vm.displayName)
                            .textContentType(.name)
                            .counterInput()

                        if let error = vm.errorMessage {
                            Text(error)
                                .font(CounterFont.body(13))
                                .foregroundStyle(theme.danger)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        Button {
                            Task { await vm.submit() }
                        } label: {
                            if vm.isLoading {
                                ProgressView().tint(.black)
                            } else {
                                Text("Create account")
                            }
                        }
                        .counterPrimaryButton(isLoading: vm.isLoading)
                        .disabled(vm.isLoading)
                    }
                    .padding(.horizontal, CounterSpacing.xl)
                }
                .padding(.bottom, CounterSpacing.xxl)
            }
        }
        .navigationTitle("Register")
        .navigationBarTitleDisplayMode(.inline)
    }
}
